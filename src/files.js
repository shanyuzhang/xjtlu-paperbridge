export function safeName(value) {
  return String(value || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150) || 'file';
}
