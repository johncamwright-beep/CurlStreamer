# Tapo cameras in Studio

Each camera slot can use a phone or a Tapo camera, including one of each. Camera source settings belong to this Windows account and apply again when Studio starts its checked local controller.

1. Set up your supported RTSP Tapo camera in the Tapo app. Connect the camera and Studio PC to the same local network.
2. In the camera's Advanced Settings, create a **Camera Account** for local RTSP access. Use this local username and password, not your Tapo email and account password.
3. Find the camera's private IPv4 address in Device Info. A router DHCP reservation helps keep that address stable.
4. In Studio, open **Camera sources → Camera 1 settings** or **Camera 2 settings**. The scoring tile's **Settings** button opens this same native window.
5. Select **Tapo (local RTSP)**, enter the address and Camera Account credentials, and choose `stream1` for higher quality or `stream2` for lower bandwidth. The RTSP port is fixed to 554.
6. Choose 0°, 90°, 180° or 270° rotation. Studio contains the complete rotated frame; it does not crop or stretch the image.
7. Choose **Save and test connection**. If Studio is connected to this game, the slot switches immediately. Otherwise the source is saved for the next camera startup. Only **Receiving fresh camera video** confirms delivery; a saved setting or connecting status does not confirm camera access.

The Tapo tile shows its source and video status. **Reconnect camera** appears when fresh video is unavailable. Check the IP, local Camera Account and Wi-Fi in Settings if recovery fails. Use the tile's mic and volume controls for the Tapo camera microphone. Tapo slots have no phone QR invitation or phone zoom controls. USB commentary audio remains available.

Select **Phone** in that slot's settings to switch back to the existing phone workflow. Changing the other slot does not release a phone assignment. Source changes do not alter the game score or YouTube connection.

Camera credentials remain in the native Studio process and its local controller. Studio stores them encrypted with Windows DPAPI CurrentUser in `%LOCALAPPDATA%\CurlStreamer\Studio\CameraInputs.dat`; browser messages and website state contain only safe source and connection facts. The saved settings cannot be read under a different Windows account. Re-enter them in Camera sources if local settings are damaged or the Windows profile changes.

Automated checks cover validation, credential boundaries, encrypted persistence and source switching. Physical camera access, network loss and rotation still need verification with a supported Tapo camera on the rink network; automated tests do not establish hardware compatibility.
