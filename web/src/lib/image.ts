// Phone photos are often 5–12 MB (and HEIC on iPhones): shrink them before
// upload so it is quick on mobile data. Re-encoding also drops the EXIF block
// (GPS position of the home). Any failure falls back to the original file;
// the server resizes and strips metadata anyway.

const MAX_SIDE = 2400;
const KEEP_BELOW_BYTES = 3_500_000;

export async function prepareImage(file: File): Promise<File> {
  const isHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (!isHeic && file.size <= KEEP_BELOW_BYTES) return file;
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob || (!isHeic && blob.size >= file.size)) return file;
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`;
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
