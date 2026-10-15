import { createProgramUsbMix } from "./program-usb-mix";

let active:
  | {
      context: AudioContext;
      mix: ReturnType<typeof createProgramUsbMix>;
      users: number;
    }
  | undefined;

/** One private-renderer output protects the combined USB and phone microphone mix. */
export function acquireProgramAudioOutput() {
  if (!active) {
    const context = new AudioContext({ sampleRate: 48_000 });
    active = { context, mix: createProgramUsbMix(context), users: 0 };
  }
  const output = active;
  output.users++;
  let released = false;
  return {
    context: output.context,
    input: output.mix.input,
    release() {
      if (released) return;
      released = true;
      if (--output.users === 0) {
        output.mix.disconnect();
        void output.context.close();
        if (active === output) active = undefined;
      }
    },
  };
}
