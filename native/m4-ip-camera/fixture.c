/* Generates synthetic moving video for local RTSP tests; never packaged. */
#include <windows.h>
#include <stdint.h>
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <libavutil/log.h>
int main(void)
{
    av_log_set_level(AV_LOG_QUIET);
    const AVCodec *codec=avcodec_find_encoder_by_name("libx264");
    AVCodecContext *ctx=avcodec_alloc_context3(codec); AVFrame *f=av_frame_alloc(); AVPacket *p=av_packet_alloc();
    if (!codec || !ctx || !f || !p) return 1;
    ctx->width=192; ctx->height=128; ctx->pix_fmt=AV_PIX_FMT_YUV420P;
    ctx->time_base=(AVRational){1,20}; ctx->framerate=(AVRational){20,1}; ctx->gop_size=20; ctx->max_b_frames=0;
    av_opt_set(ctx->priv_data,"preset","ultrafast",0); av_opt_set(ctx->priv_data,"tune","zerolatency",0);
    av_opt_set(ctx->priv_data,"x264-params","repeat-headers=1",0);
    if (avcodec_open2(ctx,codec,NULL)<0) return 1;
    f->width=192; f->height=128; f->format=AV_PIX_FMT_YUV420P;
    if (av_frame_get_buffer(f,32)<0) return 1;
    HANDLE out=GetStdHandle(STD_OUTPUT_HANDLE);
    for (int i=0;i<80;++i) {
        if (av_frame_make_writable(f)<0) return 1;
        for (int y=0;y<128;++y) for (int x=0;x<192;++x)
            f->data[0][y*f->linesize[0]+x]=(uint8_t)(y>=120 ? 32+(x+i*3)%180 : x<96 ? 50 : 200);
        for (int y=0;y<64;++y) for (int x=0;x<96;++x) { f->data[1][y*f->linesize[1]+x]=90; f->data[2][y*f->linesize[2]+x]=170; }
        f->pts=i;
        if (avcodec_send_frame(ctx,f)<0 || avcodec_receive_packet(ctx,p)<0) return 1;
        DWORD sent; uint32_t n=(uint32_t)p->size;
        if (!WriteFile(out,&n,4,&sent,NULL) || !WriteFile(out,p->data,n,&sent,NULL)) return 1;
        av_packet_unref(p);
    }
    av_frame_free(&f); av_packet_free(&p); avcodec_free_context(&ctx); return 0;
}
