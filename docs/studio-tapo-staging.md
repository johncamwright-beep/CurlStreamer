# Reproduce the Tapo Studio staging package

Build into a new directory beneath the checkout's ignored `work/` folder. These commands assemble and verify files; they do not install Studio or start a broadcast.

```powershell
$setup = '<verified setup directory>'
$baseline = '<verified 0.4.0-pilot.8 package directory>'
$baselineHash = 'eb9384b93e0315b6187900f073a314aa29ef24a33dd772887d1b4dbe6e9e6ee7'
$stage = '<checkout>/work/studio-0.5.0-pilot.1'
$helper = ./scripts/build-m4-ip-camera.ps1 -SetupRoot $setup -Destination ./build/ip-camera | Select-Object -Last 1
./scripts/build-m5-studio.ps1 -SetupRoot $setup -Destination $stage -Configuration "$baseline/studio.json" -BaselineStudio $baseline -BaselineManifestSha256 $baselineHash -IpCameraHelper $helper
$sourceArchive = ./scripts/prepare-studio-source.ps1 -StudioSource $stage
node scripts/prepare-studio-notices.mjs $stage $setup https://github.com/johncamwright-beep/CurlStreamer $sourceArchive '<verified CEF source directory>'
./scripts/build-m5-installer.ps1 -StudioSource $stage -InstallerOutput ./work/studio-installer -VerifyOnly -AllowStreamingPreview
node scripts/check-m5-studio.mjs $stage
```

The baseline mode verifies every manifest-listed file before copying it. It retains the patched host, recorder, memory-service binaries, pinned OBS/Node/WebView2 runtime and notice inputs, then rebuilds the launcher, controller, renderer and IP camera receiver. `baseline-provenance.json` records the baseline manifest digest and retained native digests; package metadata uses the existing strict manifest format.

The source archive includes current uncommitted and untracked source, plus an inventory of its hashes. Run source preparation again after any source edits, then refresh notices and verify the manifest again. The notice inventory preserves historical references for retained native components and identifies the local source archive for the current launcher, controller, renderer and receiver. A repository reference is not a claim that this staged release has been published.

`-VerifyOnly` checks all hashes, required components, public configuration and unexpected/linked files without requiring an installer compiler. To compile an installer separately, provide the existing Inno Setup compiler through `-CompilerPath` and omit `-VerifyOnly`. Packaging does not authorize installation or publication.
