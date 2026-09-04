/** GitHub Release attachments use one signed redirect to GitHub's asset storage. */
export const fetchSpeechAssetArchive = async (
  source: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> => {
  const url = new URL(source);
  const githubRelease =
    url.origin === 'https://github.com' &&
    !url.username &&
    !url.password &&
    url.pathname.startsWith('/ph1gros/fpnf-resources/releases/download/');
  const response = await fetcher(source, { ...init, redirect: githubRelease ? 'manual' : 'error' });
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get('location');
  await response.body?.cancel();
  if (
    !githubRelease ||
    ![301, 302, 303, 307, 308].includes(response.status) ||
    !location ||
    location.length > 4096
  ) {
    throw new Error('语音资源下载跳转无效。');
  }
  let destination: URL;
  try {
    destination = new URL(location);
  } catch {
    throw new Error('语音资源下载跳转无效。');
  }
  if (
    destination.origin !== 'https://release-assets.githubusercontent.com' ||
    destination.username ||
    destination.password ||
    destination.hash
  ) {
    throw new Error('语音资源下载跳转来源不受支持。');
  }
  const asset = await fetcher(destination.toString(), { ...init, redirect: 'error' });
  if (asset.status >= 300 && asset.status < 400) {
    await asset.body?.cancel();
    throw new Error('语音资源下载跳转次数过多。');
  }
  return asset;
};
