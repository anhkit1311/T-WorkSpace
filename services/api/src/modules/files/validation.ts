import { HttpError } from "../../shared/http/http-error.js";
export function validateFile(data: Buffer, mime: string) {
  const signature = (bytes: number[], offset = 0) =>
    bytes.every((byte, index) => data[offset + index] === byte);
  const prefix = (value: string, offset = 0) =>
    data.subarray(offset, offset + value.length).toString("ascii") === value;
  const valid =
    mime === "image/png"
      ? signature([137, 80, 78, 71, 13, 10, 26, 10])
      : mime === "image/jpeg"
        ? signature([255, 216, 255])
        : mime === "image/webp"
          ? prefix("RIFF") && prefix("WEBP", 8)
          : mime === "image/gif"
            ? prefix("GIF87a") || prefix("GIF89a")
            : mime === "audio/webm"
              ? signature([26, 69, 223, 163])
              : mime === "audio/ogg"
                ? prefix("OggS")
                : mime === "audio/mp4"
                  ? prefix("ftyp", 4)
                  : mime === "audio/mpeg"
                    ? prefix("ID3") || (data[0] === 255 && (data[1] & 224) === 224)
                    : mime === "application/pdf"
                      ? prefix("%PDF-")
                      : mime === "application/zip"
                        ? signature([80, 75, 3, 4])
                        : mime ===
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          ? signature([80, 75, 3, 4]) &&
                            data.includes(Buffer.from("[Content_Types].xml")) &&
                            data.includes(Buffer.from("word/document.xml"))
                          : mime === "text/plain"
                            ? !data.includes(0) &&
                              Buffer.from(data.toString("utf8"), "utf8").equals(data)
                            : false;
  if (!valid)
    throw new HttpError(415, "INVALID_SIGNATURE", "Nội dung tệp không khớp định dạng khai báo.");
}
export function cleanFileName(header: unknown) {
  try {
    return (
      Array.from(decodeURIComponent(String(header ?? "tep-dinh-kem")))
        .map((character) =>
          character === "/" || character === "\\" || character.charCodeAt(0) < 32 ? "_" : character,
        )
        .join("")
        .slice(0, 180) || "tep-dinh-kem"
    );
  } catch {
    return "tep-dinh-kem";
  }
}
