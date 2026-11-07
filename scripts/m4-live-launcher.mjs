import nextEnv from "@next/env";
import { pathToFileURL } from "node:url";

nextEnv.loadEnvConfig(process.cwd());
const setup = process.env.CURLCAST_M4_SETUP_ROOT;
if (!setup) throw new Error("CURLCAST_M4_SETUP_ROOT is required.");
process.env.CURLCAST_M4_RECORDER_HOST = `${setup}/native-toolchain/m4-studio-recorder-build/Release/m4_studio_recorder.exe`;
process.env.CURLCAST_M4_RECORDING_ROOT = `${setup}/m4-program-recordings`;
process.env.CURLCAST_M4_CACHE_ROOT = `${setup}/m4-program-cache`;
process.env.CURLCAST_M4_RENDERER_ROOT = `${setup}/m4-program-assets`;
await import(pathToFileURL(`${setup}/m4-operator.mjs`).href);
