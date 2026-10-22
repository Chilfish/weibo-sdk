/**
 * 脚本输出统一出口。
 *
 * 保持原有 `[archive]` / `[start]` / `[n]` / `[retry]` 行格式不变，只是把
 * console 调用收敛到一处，方便后续替换成日志级别或落盘实现。
 */
export function archiveLog(message: string): void {
  console.log(`[archive] ${message}`)
}

export function progressLog(line: string): void {
  console.log(line)
}
