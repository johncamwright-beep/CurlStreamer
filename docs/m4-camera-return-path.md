# Camera receiver correction

The native recorder's fresh CEF profile sets WebRTC local-address visibility only for its exact loopback renderer origin. It never overwrites an existing profile and does not relax the direct-path verifier.

A/B testing reproduced hidden candidates with the former binary and visible host IPv4 candidates on the corrected renderer origin. A different loopback port remained hidden. Physical camera verification subsequently succeeded when the iPhone was returned to the intended camera Wi-Fi network. Its earlier black picture was a face-down phone, not receiver failure.

The controlled rehearsal verified both portrait pictures in the actual recording and received YouTube program. Keep network selection, image content and direct-path verification as separate diagnostic checks. Raw SDP and candidate addresses must not be logged. See [rehearsal evidence](m4-controlled-rehearsal.md).
