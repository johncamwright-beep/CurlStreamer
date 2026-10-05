/* Private RTSP decoder. Never print URLs, credentials or library diagnostics. */
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <jansson.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>

static volatile LONG cancelled;
static ULONGLONG deadline;
static HANDLE output;
static int rotation;

static int interrupt(void *unused)
{ (void)unused; return InterlockedCompareExchange(&cancelled, 0, 0) || GetTickCount64() >= deadline; }
static BOOL WINAPI console_stop(DWORD event)
{ (void)event; InterlockedExchange(&cancelled, 1); return TRUE; }
static DWORD WINAPI watch_input(void *unused)
{
    unsigned char byte; DWORD got; (void)unused;
    while (ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &got, NULL) && got) { /* Any further input is ignored. */ }
    InterlockedExchange(&cancelled, 1); return 0;
}
static int write_all(const void *data, DWORD length)
{
    const unsigned char *bytes = data;
    while (length) {
        DWORD sent = 0;
        if (!WriteFile(output, bytes, length, &sent, NULL) || !sent) { InterlockedExchange(&cancelled, 1); return 0; }
        bytes += sent; length -= sent;
    }
    return 1;
}
static int record(const char type[4], const void *data, uint32_t length)
{
    unsigned char header[8]; memcpy(header, type, 4);
    for (int i = 0; i < 4; ++i) header[4+i] = (unsigned char)(length >> (8*i));
    return write_all(header, 8) && write_all(data, length);
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
    p->rgb=frame(w,h,AV_PIX_FMT_RGB24); p->turned=frame(ow,oh,AV_PIX_FMT_RGB24); p->yuv=frame(ow,oh,AV_PIX_FMT_YUVJ420P);
    p->packet=av_packet_alloc();
    p->rgb_scale=sws_getContext(source->width,source->height,(enum AVPixelFormat)source->format,w,h,AV_PIX_FMT_RGB24,SWS_BILINEAR,NULL,NULL,NULL);
    p->yuv_scale=sws_getContext(ow,oh,AV_PIX_FMT_RGB24,ow,oh,AV_PIX_FMT_YUVJ420P,SWS_BILINEAR,NULL,NULL,NULL);
    p->encoder=avcodec_alloc_context3(avcodec_find_encoder(AV_CODEC_ID_MJPEG));
    if (!p->rgb || !p->turned || !p->yuv || !p->packet || !p->rgb_scale || !p->yuv_scale || !p->encoder) return 0;
    p->encoder->width=ow; p->encoder->height=oh; p->encoder->pix_fmt=AV_PIX_FMT_YUVJ420P;
    p->encoder->time_base=(AVRational){1,20}; p->encoder->flags|=AV_CODEC_FLAG_QSCALE; p->encoder->global_quality=5*FF_QP2LAMBDA;
    if (avcodec_open2(p->encoder,p->encoder->codec,NULL)<0) return 0;
    p->source_width=source->width; p->source_height=source->height; p->source_format=source->format; return 1;
}
static int jpeg(picture *p, AVFrame *source, int64_t sequence)
{
    if ((!p->encoder || p->source_width!=source->width || p->source_height!=source->height || p->source_format!=source->format) && !prepare_picture(p,source)) return 0;
    if (av_frame_make_writable(p->rgb)<0 || av_frame_make_writable(p->turned)<0 || av_frame_make_writable(p->yuv)<0) return 0;
    sws_scale(p->rgb_scale,(const uint8_t *const *)source->data,source->linesize,0,source->height,p->rgb->data,p->rgb->linesize);
    for (int y=0;y<p->rgb->height;++y) for (int x=0;x<p->rgb->width;++x) {
        int dx=x,dy=y;
        if (rotation==90) { dx=p->rgb->height-1-y; dy=x; }
        if (rotation==180) { dx=p->rgb->width-1-x; dy=p->rgb->height-1-y; }
        if (rotation==270) { dx=y; dy=p->rgb->width-1-x; }
        memcpy(p->turned->data[0]+dy*p->turned->linesize[0]+dx*3,p->rgb->data[0]+y*p->rgb->linesize[0]+x*3,3);
    }
    sws_scale(p->yuv_scale,(const uint8_t *const *)p->turned->data,p->turned->linesize,0,p->turned->height,p->yuv->data,p->yuv->linesize);
    p->yuv->pts=sequence; p->yuv->quality=p->encoder->global_quality;
    if (avcodec_send_frame(p->encoder,p->yuv)<0 || avcodec_receive_packet(p->encoder,p->packet)<0) return 0;
    int ok=p->packet->size>0 && p->packet->size<=2*1024*1024 && record("JPEG",p->packet->data,(uint32_t)p->packet->size);
    av_packet_unref(p->packet); return ok;
}

int main(int argc, char **argv)
{
    char url[10000]={0}; AVFormatContext *input=NULL; AVCodecContext *video=NULL,*audio=NULL;
    AVPacket *packet=NULL; AVFrame *decoded=NULL; SwrContext *resampler=NULL; picture pic={0};
    int result=1, vi=-1, ai=-1, ready=0; int64_t sequence=0; ULONGLONG last=0; HANDLE watcher=NULL;
    av_log_set_level(AV_LOG_QUIET); output=GetStdHandle(STD_OUTPUT_HANDLE);
    SetConsoleCtrlHandler(console_stop,TRUE);
    if (argc!=2 || !SetDllDirectoryA(argv[1]) || !read_config(url,sizeof(url))) { status("unavailable"); goto done; }
    watcher=CreateThread(NULL,0,watch_input,NULL,0,NULL); if (!watcher) goto done;
    status("connecting"); avformat_network_init(); input=avformat_alloc_context();
    if (!input) goto done;
    input->interrupt_callback=(AVIOInterruptCB){interrupt,NULL};
    AVDictionary *settings=NULL;
    av_dict_set(&settings,"rtsp_transport","tcp",0); av_dict_set(&settings,"timeout","3000000",0);
    av_dict_set(&settings,"rw_timeout","3000000",0); av_dict_set(&settings,"protocol_whitelist","rtsp,tcp",0);
    av_dict_set(&settings,"analyzeduration","1000000",0);
    deadline=GetTickCount64()+4000;
    int opened=avformat_open_input(&input,url,NULL,&settings); av_dict_free(&settings); SecureZeroMemory(url,sizeof(url));
    if (opened<0) { status(opened==AVERROR_HTTP_UNAUTHORIZED || opened==AVERROR_HTTP_FORBIDDEN?"auth_failed":"unavailable"); goto done; }
    deadline=GetTickCount64()+4000;
    if (avformat_find_stream_info(input,NULL)<0) { status("unavailable"); goto done; }
    vi=av_find_best_stream(input,AVMEDIA_TYPE_VIDEO,-1,-1,NULL,0);
    ai=av_find_best_stream(input,AVMEDIA_TYPE_AUDIO,-1,-1,NULL,0);
    if (vi<0) goto done;
    video=avcodec_alloc_context3(avcodec_find_decoder(input->streams[vi]->codecpar->codec_id));
    if (!video || avcodec_parameters_to_context(video,input->streams[vi]->codecpar)<0 || avcodec_open2(video,video->codec,NULL)<0) goto done;
    video->thread_count=2;
    if (ai>=0) {
        audio=avcodec_alloc_context3(avcodec_find_decoder(input->streams[ai]->codecpar->codec_id));
        if (!audio || avcodec_parameters_to_context(audio,input->streams[ai]->codecpar)<0 || avcodec_open2(audio,audio->codec,NULL)<0) { avcodec_free_context(&audio); ai=-1; }
    }
    packet=av_packet_alloc(); decoded=av_frame_alloc(); if (!packet || !decoded) goto done;
    while (!InterlockedCompareExchange(&cancelled,0,0)) {
        deadline=GetTickCount64()+4000;
        if (av_read_frame(input,packet)<0) break;
        AVCodecContext *decoder=packet->stream_index==vi?video:packet->stream_index==ai?audio:NULL;
        if (decoder && avcodec_send_packet(decoder,packet)>=0) while (avcodec_receive_frame(decoder,decoded)>=0) {
            if (decoder==video) {
                ULONGLONG now=GetTickCount64();
                if (now-last>=50) {
                    if (!jpeg(&pic,decoded,sequence++)) { InterlockedExchange(&cancelled,1); break; }
                    last=now; if (!ready) { status("streaming"); ready=1; }
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
        av_packet_unref(packet);
    }
    result=InterlockedCompareExchange(&cancelled,0,0)?0:1;
    if (result) status("unavailable");
done:
    SecureZeroMemory(url,sizeof(url)); av_packet_free(&packet); av_frame_free(&decoded); free_picture(&pic);
    swr_free(&resampler); avcodec_free_context(&video); avcodec_free_context(&audio); avformat_close_input(&input); avformat_network_deinit();
    if (watcher) { CancelSynchronousIo(watcher); CloseHandle(watcher); }
    return result;
}
