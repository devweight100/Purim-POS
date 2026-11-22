/** Which of เปิดใช้งาน / ปิดการใช้งาน the bulk bar shows for the selected ids (unknown state = could be either). */
export function bulkActiveActions(ids: string[], activeById: Record<string, boolean>) {
  let showEnable = false;
  let showDisable = false;
  for (const id of ids) {
    const a = activeById[id];
    if (a !== true) showEnable = true;
    if (a !== false) showDisable = true;
    if (showEnable && showDisable) break;
  }
  return { showEnable, showDisable };
}
