/* Private RTSP decoder. Never print URLs, credentials or library diagnostics. */
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <errno.h>
#include <jansson.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libavutil/error.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>

static volatile LONG cancelled, timed_out;
static ULONGLONG deadline;
static HANDLE output;
static int rotation;
/* One latest record per media kind. A slow stdout consumer must not stop RTSP
 * reads (and its session keepalive), or accumulate an unbounded frame queue. */
typedef struct queued_record { unsigned char *data; uint32_t length; } queued_record;
static queued_record queued[4];
static CRITICAL_SECTION queue_lock;
static HANDLE queue_ready, writer;
static volatile LONG output_failed, writer_stopping, closing;

static int interrupt(void *unused)
{
    (void)unused;
    if (InterlockedCompareExchange(&cancelled,0,0)) return 1;
    if (GetTickCount64()>=deadline) { InterlockedExchange(&timed_out,1); return 1; }
    return 0;
}
static BOOL WINAPI console_stop(DWORD event)
{ (void)event; InterlockedExchange(&cancelled, 1); return TRUE; }
static DWORD WINAPI watch_input(void *unused)
{
    unsigned char byte; DWORD got; (void)unused;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &got, NULL) && got) { /* Any further input is ignored. */ }
    if (InterlockedCompareExchange(&closing,0,0)) return 0;
    InterlockedExchange(&cancelled, 1);
    if (writer) CancelSynchronousIo(writer);
    if (queue_ready) SetEvent(queue_ready);
    return 0;
}
static int write_all(const void *data, DWORD length)
{
    const unsigned char *bytes = data;
    while (length) {
        DWORD sent = 0;
        if (!WriteFile(output, bytes, length, &sent, NULL) || !sent) { InterlockedExchange(&output_failed, 1); InterlockedExchange(&cancelled, 1); return 0; }
        bytes += sent; length -= sent;
    }
    return 1;
}
static int write_record(const char type[4], const void *data, uint32_t length)
{
    unsigned char header[8]; memcpy(header, type, 4);
    for (int i = 0; i < 4; ++i) header[4+i] = (unsigned char)(length >> (8*i));
    return write_all(header, 8) && write_all(data, length);
}
static DWORD WINAPI write_output(void *unused)
{
    static const char tags[4][5]={"STAT","JPEG","PCMA","DIAG"}; (void)unused;
    for (;;) {
        WaitForSingleObject(queue_ready, INFINITE);
        for (int i=0;i<4;++i) {
            EnterCriticalSection(&queue_lock);
            queued_record next=queued[i]; queued[i]=(queued_record){0};
            LeaveCriticalSection(&queue_lock);
            if (next.data) {
                int ok=write_record(tags[i],next.data,next.length); free(next.data);
                if (!ok) return 0;
            }
        }
        EnterCriticalSection(&queue_lock);
        int pending=queued[0].data || queued[1].data || queued[2].data || queued[3].data;
        int stopped=InterlockedCompareExchange(&writer_stopping,0,0) && !pending;
        LeaveCriticalSection(&queue_lock);
        if (stopped) return 0;
        if (pending) SetEvent(queue_ready);
    }
}
static int record(const char type[4], const void *data, uint32_t length)
{
    if (!writer) return write_record(type,data,length);
    int kind=!memcmp(type,"STAT",4)?0:!memcmp(type,"JPEG",4)?1:!memcmp(type,"PCMA",4)?2:3;
    unsigned char *copy=malloc(length);
    if (!copy) return 0;
    memcpy(copy,data,length);
    EnterCriticalSection(&queue_lock);
    if (kind==2 && queued[kind].length) {
        /* Preserve decoded audio bursts up to the same 100ms bound as the
         * parent. Drop oldest whole signed16 samples only when the cap fills. */
        uint32_t retained=length<9600?9600-length:0;
        if (retained>queued[kind].length) retained=queued[kind].length;
        unsigned char *joined=malloc(retained+length);
        if (!joined) { LeaveCriticalSection(&queue_lock); free(copy); return 0; }
        memcpy(joined,queued[kind].data+queued[kind].length-retained,retained);
        memcpy(joined+retained,copy,length); free(copy); copy=joined; length+=retained;
    }
    free(queued[kind].data); queued[kind]=(queued_record){copy,length};
    LeaveCriticalSection(&queue_lock);
    SetEvent(queue_ready);
    return !InterlockedCompareExchange(&output_failed,0,0);
}
static void status(const char *code)
{
    char safe[96]; int n = snprintf(safe, sizeof(safe), "{\"code\":\"%s\"}", code);
    if (n > 0 && n < (int)sizeof(safe)) record("STAT", safe, (uint32_t)n);
}
/* Jansson supplies valid UTF-8. Count UTF-16 units to match native/JS schemas. */
static int bounded_text(const char *text, size_t bytes, int limit, int path)
{
    if (!text || strlen(text)!=bytes) return 0;
    const unsigned char *v=(const unsigned char *)text; int units=0;
    while (*v) {
        unsigned cp=*v++;
        if (cp>=0xf0) { cp=(cp&7)<<18; cp|=(*v++&63)<<12; cp|=(*v++&63)<<6; cp|=*v++&63; }
        else if (cp>=0xe0) { cp=(cp&15)<<12; cp|=(*v++&63)<<6; cp|=*v++&63; }
        else if (cp>=0xc0) { cp=(cp&31)<<6; cp|=*v++&63; }
        units+=cp>0xffff?2:1;
        if (units>limit || cp<32 || cp==127) return 0;
        if (path && (cp==32 || cp=='#' || cp=='\\' || cp==0xa0 || cp==0x1680 ||
            (cp>=0x2000 && cp<=0x200a) || cp==0x2028 || cp==0x2029 || cp==0x202f || cp==0x205f || cp==0x3000 || cp==0xfeff)) return 0;
    }
    return !path || (units>0 && text[0]=='/');
}
static int read_config(char *url, size_t capacity)
{
    char input[20000] = {0}, user[1537] = {0}, password[3073] = {0}; DWORD got; size_t n = 0;
    json_t *root = NULL; int valid = 0; ULONGLONG startup_deadline=GetTickCount64()+4000;
    while (n < sizeof(input)-1) {
        DWORD available=0;
        if (!PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE),NULL,0,NULL,&available,NULL)) goto done;
        if (!available) { if (GetTickCount64()>=startup_deadline) goto done; Sleep(5); continue; }
        if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), input+n, 1, &got, NULL) || !got) goto done;
        if (input[n++] == '\n') break;
    }
    if (!n || input[n-1] != '\n') goto done;
    root = json_loadb(input, n, JSON_REJECT_DUPLICATES, NULL);
    if (!json_is_object(root) || json_object_size(root) != 7) goto done;
    json_t *ver=json_object_get(root,"version"), *port=json_object_get(root,"port"), *rot=json_object_get(root,"rotation");
    const char *host=json_string_value(json_object_get(root,"host"));
    const char *u=json_string_value(json_object_get(root,"username"));
    const char *p=json_string_value(json_object_get(root,"password"));
    const char *stream=json_string_value(json_object_get(root,"stream"));
    const char *path=json_string_value(json_object_get(root,"path"));
    int legacy=json_is_integer(ver) && json_integer_value(ver)==1;
    if (!json_is_integer(ver) || (!legacy && json_integer_value(ver)!=2) || !json_is_integer(port) ||
        json_integer_value(port)<1 || json_integer_value(port)>65535 || !json_is_integer(rot) ||
        !host || !u || !p || (legacy ? (!stream || (strcmp(stream,"stream1") && strcmp(stream,"stream2"))) :
        (!path || json_string_length(json_object_get(root,"path"))>4096 || !bounded_text(path,json_string_length(json_object_get(root,"path")),1024,1)))) goto done;
    json_int_t angle=json_integer_value(rot);
    if (angle!=0 && angle!=90 && angle!=180 && angle!=270) goto done;
    rotation=(int)angle;
    unsigned a,b,c,d; char tail;
    if (sscanf_s(host,"%u.%u.%u.%u%c",&a,&b,&c,&d,&tail,1)!=4 || a>255 || b>255 || c>255 || d>255 ||
        !(a==10 || (a==172 && b>=16 && b<=31) || (a==192 && b==168) || (a==127 && b==0 && c==0 && d==1))) goto done;
    if ((legacy && (!*u || !*p)) || strlen(u)>512 || strlen(p)>1024 ||
        !bounded_text(u,json_string_length(json_object_get(root,"username")),128,0) ||
        !bounded_text(p,json_string_length(json_object_get(root,"password")),256,0)) goto done;
    const char *src[2]={u,p}; char *dest[2]={user,password};
    for (int j=0;j<2;++j) {
        size_t at=0;
        for (const unsigned char *v=(const unsigned char *)src[j];*v;++v) {
            if ((*v>='a'&&*v<='z') || (*v>='A'&&*v<='Z') || (*v>='0'&&*v<='9') || strchr("-._~",*v)) dest[j][at++]=(char)*v;
            else { snprintf(dest[j]+at,4,"%%%02X",*v); at+=3; }
        }
    }
    /* Reject before FFmpeg can silently truncate its 128-byte RTSP auth buffer. */
    if (!legacy && strlen(user)+1+strlen(password)>127) goto done;
    int count;
    if (!legacy && !*u && !*p) count=snprintf(url,capacity,"rtsp://%u.%u.%u.%u:%lld%s",a,b,c,d,json_integer_value(port),path);
    else count=snprintf(url,capacity,"rtsp://%s:%s@%u.%u.%u.%u:%lld%s%s",user,password,a,b,c,d,json_integer_value(port),legacy?"/":"",legacy?stream:path);
    valid=count>0 && (size_t)count<capacity;
done:
    if (root) {
        const char *secret=json_string_value(json_object_get(root,"password"));
        if (secret) SecureZeroMemory((void *)secret,json_string_length(json_object_get(root,"password")));
        secret=json_string_value(json_object_get(root,"username"));
        if (secret) SecureZeroMemory((void *)secret,json_string_length(json_object_get(root,"username")));
        secret=json_string_value(json_object_get(root,"path"));
        if (secret) SecureZeroMemory((void *)secret,json_string_length(json_object_get(root,"path")));
        json_decref(root);
    }
    SecureZeroMemory(input,sizeof(input)); SecureZeroMemory(user,sizeof(user)); SecureZeroMemory(password,sizeof(password));
    return valid;
}

typedef struct picture {
    struct SwsContext *rgb_scale, *yuv_scale;
    AVCodecContext *encoder;
    AVFrame *rgb, *turned, *yuv;
    AVPacket *packet;
    int source_width, source_height, source_format;
} picture;
static void free_picture(picture *p)
{
    sws_freeContext(p->rgb_scale); sws_freeContext(p->yuv_scale);
    avcodec_free_context(&p->encoder); av_frame_free(&p->rgb); av_frame_free(&p->turned); av_frame_free(&p->yuv); av_packet_free(&p->packet);
    memset(p,0,sizeof(*p));
}
static AVFrame *frame(int width, int height, enum AVPixelFormat format)
{
    AVFrame *f=av_frame_alloc(); if (!f) return NULL;
    f->width=width; f->height=height; f->format=format;
    if (av_frame_get_buffer(f,32)<0) av_frame_free(&f);
    return f;
}
static int prepare_picture(picture *p, AVFrame *source)
{
    free_picture(p);
    if (source->width<2 || source->height<2 || source->width>8192 || source->height>8192) return 0;
    int ow=(rotation==90 || rotation==270)?source->height:source->width;
    int oh=(rotation==90 || rotation==270)?source->width:source->height;
    double scale=1.0;
    if (ow>1280) scale=1280.0/ow;
    if (oh*scale>1920) scale=1920.0/oh;
    ow=((int)(ow*scale)) & ~1; oh=((int)(oh*scale)) & ~1;
    if (ow<2 || oh<2) return 0;
    int w=(rotation==90 || rotation==270)?oh:ow, h=(rotation==90 || rotation==270)?ow:oh;
    p->yuv=frame(ow,oh,AV_PIX_FMT_YUVJ420P);
    p->packet=av_packet_alloc();
    if (rotation) {
        p->rgb=frame(w,h,AV_PIX_FMT_RGB24); p->turned=frame(ow,oh,AV_PIX_FMT_RGB24);
        p->rgb_scale=sws_getContext(source->width,source->height,(enum AVPixelFormat)source->format,w,h,AV_PIX_FMT_RGB24,SWS_BILINEAR,NULL,NULL,NULL);
        p->yuv_scale=sws_getContext(ow,oh,AV_PIX_FMT_RGB24,ow,oh,AV_PIX_FMT_YUVJ420P,SWS_BILINEAR,NULL,NULL,NULL);
    } else p->yuv_scale=sws_getContext(source->width,source->height,(enum AVPixelFormat)source->format,ow,oh,AV_PIX_FMT_YUVJ420P,SWS_BILINEAR,NULL,NULL,NULL);
    p->encoder=avcodec_alloc_context3(avcodec_find_encoder(AV_CODEC_ID_MJPEG));
    if (!p->yuv || !p->packet || !p->yuv_scale || !p->encoder || (rotation && (!p->rgb || !p->turned || !p->rgb_scale))) return 0;
    p->encoder->width=ow; p->encoder->height=oh; p->encoder->pix_fmt=AV_PIX_FMT_YUVJ420P;
    p->encoder->time_base=(AVRational){1,1000}; p->encoder->flags|=AV_CODEC_FLAG_QSCALE; p->encoder->global_quality=5*FF_QP2LAMBDA;
    if (avcodec_open2(p->encoder,p->encoder->codec,NULL)<0) return 0;
    p->source_width=source->width; p->source_height=source->height; p->source_format=source->format; return 1;
}
static int jpeg(picture *p, AVFrame *source, int64_t sequence)
{
    if ((!p->encoder || p->source_width!=source->width || p->source_height!=source->height || p->source_format!=source->format) && !prepare_picture(p,source)) return 0;
    if (av_frame_make_writable(p->yuv)<0) return 0;
    if (rotation) {
    if (av_frame_make_writable(p->rgb)<0 || av_frame_make_writable(p->turned)<0) return 0;
    sws_scale(p->rgb_scale,(const uint8_t *const *)source->data,source->linesize,0,source->height,p->rgb->data,p->rgb->linesize);
    for (int y=0;y<p->rgb->height;++y) for (int x=0;x<p->rgb->width;++x) {
        int dx=x,dy=y;
        if (rotation==90) { dx=p->rgb->height-1-y; dy=x; }
        if (rotation==180) { dx=p->rgb->width-1-x; dy=p->rgb->height-1-y; }
        if (rotation==270) { dx=y; dy=p->rgb->width-1-x; }
        memcpy(p->turned->data[0]+dy*p->turned->linesize[0]+dx*3,p->rgb->data[0]+y*p->rgb->linesize[0]+x*3,3);
    }
    sws_scale(p->yuv_scale,(const uint8_t *const *)p->turned->data,p->turned->linesize,0,p->turned->height,p->yuv->data,p->yuv->linesize);
    } else sws_scale(p->yuv_scale,(const uint8_t *const *)source->data,source->linesize,0,source->height,p->yuv->data,p->yuv->linesize);
    p->yuv->pts=sequence; p->yuv->quality=p->encoder->global_quality;
    if (avcodec_send_frame(p->encoder,p->yuv)<0 || avcodec_receive_packet(p->encoder,p->packet)<0) return 0;
    int ok=p->packet->size>0 && p->packet->size<=2*1024*1024 && record("JPEG",p->packet->data,(uint32_t)p->packet->size);
    av_packet_unref(p->packet); return ok;
}

int main(int argc, char **argv)
{
    char url[10000]={0}; AVFormatContext *input=NULL; AVCodecContext *video=NULL,*audio=NULL;
    AVPacket *packet=NULL; AVFrame *decoded=NULL; SwrContext *resampler=NULL; picture pic={0};
    int result=1, vi=-1, ai=-1, ready=0; int64_t next_frame=AV_NOPTS_VALUE, pts_origin=AV_NOPTS_VALUE;
    ULONGLONG clock_origin=GetTickCount64(); HANDLE watcher=NULL; const char *failure="unavailable";
    uint64_t decoded_frames=0, decode_errors=0;
    ULONGLONG next_diagnostic=0, processing_ms=0;
    av_log_set_level(AV_LOG_QUIET); output=GetStdHandle(STD_OUTPUT_HANDLE);
    SetConsoleCtrlHandler(console_stop,TRUE);
    if (argc!=2 || !SetDllDirectoryA(argv[1]) || !read_config(url,sizeof(url))) { status("unavailable"); goto done; }
    InitializeCriticalSection(&queue_lock); queue_ready=CreateEventW(NULL,FALSE,FALSE,NULL);
    if (!queue_ready) { DeleteCriticalSection(&queue_lock); goto done; }
    writer=CreateThread(NULL,0,write_output,NULL,0,NULL);
    if (!writer) goto done;
    watcher=CreateThread(NULL,0,watch_input,NULL,0,NULL); if (!watcher) goto done;
    status("connecting"); avformat_network_init(); input=avformat_alloc_context();
    if (!input) goto done;
    input->interrupt_callback=(AVIOInterruptCB){interrupt,NULL};
    AVDictionary *settings=NULL;
    /* The interrupt owns the actual deadline; the socket timeout is a backup.
     * This preserves fixed timeout evidence when FFmpeg collapses I/O errors. */
    av_dict_set(&settings,"rtsp_transport","tcp",0); av_dict_set(&settings,"timeout","4000000",0);
    av_dict_set(&settings,"rw_timeout","4000000",0); av_dict_set(&settings,"protocol_whitelist","rtsp,tcp",0);
    av_dict_set(&settings,"analyzeduration","1000000",0);
    deadline=GetTickCount64()+4000;
    int opened=avformat_open_input(&input,url,NULL,&settings); av_dict_free(&settings); SecureZeroMemory(url,sizeof(url));
    if (opened<0) { status(opened==AVERROR_HTTP_UNAUTHORIZED || opened==AVERROR_HTTP_FORBIDDEN?"auth_failed":
        opened==AVERROR(ETIMEDOUT) || (opened==AVERROR_EXIT && GetTickCount64()>=deadline)?"read_timeout":"unavailable"); goto done; }
    deadline=GetTickCount64()+4000;
    int info=avformat_find_stream_info(input,NULL);
    if (info<0) { status(info==AVERROR(ETIMEDOUT) || GetTickCount64()>=deadline?"read_timeout":"unavailable"); goto done; }
    vi=av_find_best_stream(input,AVMEDIA_TYPE_VIDEO,-1,-1,NULL,0);
    ai=av_find_best_stream(input,AVMEDIA_TYPE_AUDIO,-1,-1,NULL,0);
    if (vi<0) { status("decode_failed"); goto done; }
    video=avcodec_alloc_context3(avcodec_find_decoder(input->streams[vi]->codecpar->codec_id));
    if (video) video->thread_count=2;
    if (!video || avcodec_parameters_to_context(video,input->streams[vi]->codecpar)<0 || avcodec_open2(video,video->codec,NULL)<0) { status("decode_failed"); goto done; }
    if (ai>=0) {
        audio=avcodec_alloc_context3(avcodec_find_decoder(input->streams[ai]->codecpar->codec_id));
        if (!audio || avcodec_parameters_to_context(audio,input->streams[ai]->codecpar)<0 || avcodec_open2(audio,audio->codec,NULL)<0) { avcodec_free_context(&audio); ai=-1; }
    }
    packet=av_packet_alloc(); decoded=av_frame_alloc(); if (!packet || !decoded) goto done;
    deadline=GetTickCount64()+3000;
    while (!InterlockedCompareExchange(&cancelled,0,0)) {
        int read=av_read_frame(input,packet);
        if (InterlockedCompareExchange(&timed_out,0,0)) { failure="read_timeout"; break; }
        if (read<0) {
            /* EAGAIN and one damaged RTP packet are recoverable, but never reset
             * the deadline until actual input advances. A dead stream expires. */
            if ((read==AVERROR(EAGAIN) || read==AVERROR_INVALIDDATA) && GetTickCount64()<deadline) { av_packet_unref(packet); Sleep(5); continue; }
            failure=read==AVERROR(ETIMEDOUT) || (read==AVERROR_EXIT && GetTickCount64()>=deadline)?"read_timeout":
                read==AVERROR_EOF || read==AVERROR(ECONNRESET) || read==AVERROR(EIO)?"connection_closed":"unavailable";
            break;
        }
        deadline=GetTickCount64()+3000;
        AVCodecContext *decoder=packet->stream_index==vi?video:packet->stream_index==ai?audio:NULL;
        int sent=decoder?avcodec_send_packet(decoder,packet):0;
        if (decoder && sent<0 && sent!=AVERROR(EAGAIN)) {
            ++decode_errors;
            /* A damaged audio packet must not restart an otherwise healthy
             * video feed. Flush only that decoder; video has its own watchdog. */
            if (decoder==audio) { avcodec_flush_buffers(audio); av_packet_unref(packet); continue; }
            if (sent!=AVERROR_INVALIDDATA) { failure="decode_failed"; break; }
        }
        int received=AVERROR(EAGAIN);
        if (decoder && sent>=0) while ((received=avcodec_receive_frame(decoder,decoded))>=0) {
            if (decoder==video) {
                ULONGLONG now=GetTickCount64();
                ++decoded_frames;
                int64_t timestamp=(int64_t)(now-clock_origin);
                if (decoded->best_effort_timestamp!=AV_NOPTS_VALUE) {
                    int64_t pts=av_rescale_q(decoded->best_effort_timestamp,input->streams[vi]->time_base,(AVRational){1,1000});
                    if (pts_origin==AV_NOPTS_VALUE) pts_origin=pts-timestamp;
                    timestamp=pts-pts_origin;
                }
                /* Scheduled cadence avoids dropping every second 30fps frame
                 * when integer milliseconds alternate between 33 and 34. PTS
                 * handles burst delivery; fallback uses the monotonic clock. */
                int64_t tick=timestamp*30;
                if (next_frame==AV_NOPTS_VALUE || tick+30>=next_frame || tick+30000<next_frame) {
                    if (!jpeg(&pic,decoded,timestamp)) { failure=InterlockedCompareExchange(&output_failed,0,0)?"pipe_failed":"decode_failed"; goto finished; }
                    processing_ms=GetTickCount64()-now;
                    next_frame=next_frame==AV_NOPTS_VALUE || tick>=next_frame+1000 || tick+30000<next_frame?tick+1000:next_frame+1000;
                    if (!ready) { status("streaming"); ready=1; }
                }
            } else {
                if (!resampler) {
                    AVChannelLayout mono=AV_CHANNEL_LAYOUT_MONO;
                    if (swr_alloc_set_opts2(&resampler,&mono,AV_SAMPLE_FMT_S16,48000,&decoded->ch_layout,(enum AVSampleFormat)decoded->format,decoded->sample_rate,0,NULL)<0 || swr_init(resampler)<0) { swr_free(&resampler); ai=-1; break; }
                }
                int capacity=swr_get_out_samples(resampler,decoded->nb_samples);
                if (capacity>0 && capacity<=96000) {
                    uint8_t *pcm=av_malloc((size_t)capacity*2);
                    if (pcm) { int samples=swr_convert(resampler,&pcm,capacity,(const uint8_t **)decoded->extended_data,decoded->nb_samples);
                        for (int offset=0;offset<samples;offset+=4800) {
                            int count=samples-offset; if (count>4800) count=4800;
                            if (!record("PCMA",pcm+(size_t)offset*2,(uint32_t)count*2)) break;
                        }
                        av_free(pcm); }
                }
            }
            av_frame_unref(decoded);
        }
        if (received==AVERROR_INVALIDDATA) ++decode_errors;
        if (received<0 && received!=AVERROR(EAGAIN) && received!=AVERROR_EOF && received!=AVERROR_INVALIDDATA) {
            ++decode_errors;
            if (decoder==audio) avcodec_flush_buffers(audio);
            else { failure="decode_failed"; break; }
        }
        if (GetTickCount64()>=next_diagnostic) {
            char stats[256];
            int size=snprintf(stats,sizeof(stats),"{\"decodedFrames\":%llu,\"decodeErrors\":%llu,\"processingMs\":%llu}",(unsigned long long)decoded_frames,(unsigned long long)decode_errors,(unsigned long long)processing_ms);
            if (size>0 && size<(int)sizeof(stats)) record("DIAG",stats,(uint32_t)size);
            next_diagnostic=GetTickCount64()+2000;
        }
        av_packet_unref(packet);
    }
finished:
    result=InterlockedCompareExchange(&cancelled,0,0)?0:1;
    if (result) status(failure);
done:
    SecureZeroMemory(url,sizeof(url)); av_packet_free(&packet); av_frame_free(&decoded); free_picture(&pic);
    swr_free(&resampler); avcodec_free_context(&video); avcodec_free_context(&audio); avformat_close_input(&input); avformat_network_deinit();
    InterlockedExchange(&closing,1);
    if (watcher) {
        CancelSynchronousIo(watcher);
        if (WaitForSingleObject(watcher,1000)!=WAIT_OBJECT_0) return result;
        CloseHandle(watcher);
    }
    if (writer) {
        InterlockedExchange(&writer_stopping,1); SetEvent(queue_ready);
        if (WaitForSingleObject(writer,500)!=WAIT_OBJECT_0) {
            CancelSynchronousIo(writer);
            /* Process exit reclaims the still-live worker and its shared state.
             * Never free that state until the worker has actually joined. */
            if (WaitForSingleObject(writer,1000)!=WAIT_OBJECT_0) return result;
        }
        CloseHandle(writer); writer=NULL;
    }
    if (queue_ready) {
        for (int i=0;i<4;++i) free(queued[i].data);
        CloseHandle(queue_ready); DeleteCriticalSection(&queue_lock);
    }
    return result;
}
