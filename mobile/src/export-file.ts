import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function exportFile(filename: string, content: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持文件分享");
  const directory = new Directory(Paths.cache, "ai-exports");
  directory.create({ idempotent: true, intermediates: true });
  // Files belong only to this app's export cache; keep the last ten exports.
  const previous = directory
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .sort((a, b) => (b.modificationTime || 0) - (a.modificationTime || 0));
  previous.slice(9).forEach((file) => file.delete());
  const file = new File(directory, filename);
  file.write(content);
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/markdown",
    UTI: "public.plain-text",
    dialogTitle: "导出 AI 答疑",
  });
}
