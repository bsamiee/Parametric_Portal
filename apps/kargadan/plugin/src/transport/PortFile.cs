// Atomic port file write/read/delete for harness discovery; writes JSON with port, PID, and timestamp to ~/.kargadan/port.
// Atomic rename pattern (write to .tmp, then File.Move with overwrite) prevents partial reads from the harness.
using System;
using System.IO;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [CONSTANTS] -------------------------------------------------------------

internal static class PortFile {
    private static readonly string PortFilePath =
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".kargadan",
            "port");
    private static readonly string PortFileTempPath = PortFilePath + ".tmp";
    private static readonly JsonSerializerOptions SerializerOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    // --- [TYPES] -------------------------------------------------------------

    private sealed record PortFilePayload(int Port, int Pid, DateTimeOffset StartedAt);

    // --- [FUNCTIONS] ---------------------------------------------------------

    internal static void WritePortFile(int port) {
        string directory = Path.GetDirectoryName(PortFilePath)!;
        Directory.CreateDirectory(directory);
        PortFilePayload payload = new(
            Port: port,
            Pid: Environment.ProcessId,
            StartedAt: DateTimeOffset.UtcNow);
        string json = JsonSerializer.Serialize(value: payload, options: SerializerOptions);
        File.WriteAllText(path: PortFileTempPath, contents: json);
        File.Move(sourceFileName: PortFileTempPath, destFileName: PortFilePath, overwrite: true);
    }

    // [BOUNDARY ADAPTER -- best-effort cleanup; IOException expected if Rhino force-quits]
    internal static void DeletePortFile() {
        try { File.Delete(PortFilePath); } catch (IOException) { /* best-effort cleanup on shutdown */ }
    }

    internal static Fin<(int Port, int Pid, DateTimeOffset StartedAt)> ReadPortFile() =>
        File.Exists(PortFilePath) switch {
            false => Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file not found at {PortFilePath}.")),
            true => DeserializePortFile(),
        };

    // --- [INTERNAL] ----------------------------------------------------------

    private static Fin<(int Port, int Pid, DateTimeOffset StartedAt)> DeserializePortFile() {
        // [BOUNDARY ADAPTER -- file I/O requires try/catch at boundary]
        try {
            string json = File.ReadAllText(PortFilePath);
            PortFilePayload? payload = JsonSerializer.Deserialize<PortFilePayload>(
                json: json,
                options: SerializerOptions);
            return payload switch {
                null => Fin.Fail<(int, int, DateTimeOffset)>(
                    Error.New(message: "Port file deserialized to null.")),
                _ => Fin.Succ((payload.Port, payload.Pid, payload.StartedAt)),
            };
        } catch (JsonException exception) {
            return Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file JSON is malformed: {exception.Message}"));
        } catch (IOException exception) {
            return Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file read failed: {exception.Message}"));
        }
    }
}
