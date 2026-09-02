# DJI Mic 3 audio test

1. Configure the receiver for Mono and connect it over USB-C before opening the browser.
2. Use HTTPS, grant microphone permission, enumerate inputs, and explicitly select the entry labelled DJI/USB/external. iOS Safari may not expose device labels or permit deterministic input selection; never infer success from permission alone.
3. Speak into all four transmitters, confirm each appears on the live meter, monitor for clipping/dropout, then mute/unmute and unplug/reconnect the receiver.
4. If the chosen device disappears, warn immediately and keep scoring available. Do not silently select the built-in microphone. Re-run the test after any browser/background/network transition.

External audio selection, publication, and the diagnostic page are Milestone 5 work; mock mode displays that limitation rather than claiming a receiver is live.
