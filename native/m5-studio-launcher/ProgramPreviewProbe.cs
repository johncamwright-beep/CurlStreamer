using System;
using System.IO;
internal static class ProgramPreviewProbe
{
    private static int Main(string[] args) {
        try {
            if (args.Length != 2) return 2;
            var frame = ProgramPreview.Read(args[0]);
            if (frame == null) return 3;
            int[] positions = { 54 + (90 * 640 + 160) * 4, 54 + (90 * 640 + 480) * 4, 54 + (270 * 640 + 160) * 4, 54 + (270 * 640 + 480) * 4 };
            var red = positions[0]; var green = positions[1]; var blue = positions[2]; var white = positions[3];
            if (frame[red + 2] < 180 || frame[red] > 70 || frame[red + 1] > 70 ||
                frame[green + 1] < 180 || frame[green] > 70 || frame[green + 2] > 70 ||
                frame[blue] < 180 || frame[blue + 1] > 70 || frame[blue + 2] > 70 ||
                frame[white] < 180 || frame[white + 1] < 180 || frame[white + 2] < 180) return 4;
            File.WriteAllBytes(args[1], frame);
            Console.WriteLine("PASS: preview reads current OBS program quadrants in the correct orientation.");
            return 0;
        } catch { return 5; }
    }
}
