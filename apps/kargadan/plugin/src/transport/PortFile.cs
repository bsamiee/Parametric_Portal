// Atomic port file write/read/delete for harness discovery; writes JSON with port, PID, and timestamp to ~/.kargadan/port.
// Atomic rename pattern (write to .tmp, then File.Move with overwrite) prevents partial reads from the harness.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [ADAPTER] ---------------------------------------------------------------

internal static class PortFile {
    // --- [TYPES] -------------------------------------------------------------
    [StructLayout(LayoutKind.Auto)]
    private readonly record struct PortFilePayload(int Port, int Pid, DateTimeOffset StartedAt);

    // --- [CONSTANTS] ---------------------------------------------------------
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
    internal static void DeletePortFile() {
        try {
            File.Delete(PortFilePath);
        } catch (IOException) {
            // why: best-effort cleanup on shutdown
        } catch (UnauthorizedAccessException) {
            // why: best-effort cleanup on shutdown
        }
    }
    internal static Fin<(int Port, int Pid, DateTimeOffset StartedAt)> ReadPortFile() =>
        File.Exists(PortFilePath) switch {
            false => Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file not found at {PortFilePath}.")),
            true => DeserializePortFile(),
        };
    private static Fin<(int Port, int Pid, DateTimeOffset StartedAt)> DeserializePortFile() {
        try {
            string json = File.ReadAllText(PortFilePath);
            PortFilePayload? payload = JsonSerializer.Deserialize<PortFilePayload>(
                json: json,
                options: SerializerOptions);
            return payload switch {
                null => Fin.Fail<(int, int, DateTimeOffset)>(
                    Error.New(message: "Port file deserialized to null.")),
                _ => Fin.Succ((payload.Value.Port, payload.Value.Pid, payload.Value.StartedAt)),
            };
        } catch (JsonException exception) {
            return Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file JSON is malformed: {exception.Message}"));
        } catch (IOException exception) {
            return Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file read failed: {exception.Message}"));
        } catch (UnauthorizedAccessException exception) {
            return Fin.Fail<(int, int, DateTimeOffset)>(
                Error.New(message: $"Port file access denied: {exception.Message}"));
        }
    }
}
