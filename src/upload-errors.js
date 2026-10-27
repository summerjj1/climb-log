export function uploadErrorMessage(error) {
  const status = Number(error?.status || error?.statusCode || error?.originalError?.status);
  const detail = [error?.code,error?.statusCode,error?.message,error?.originalError?.message].filter(Boolean).join(' ');
  const code = [error?.code,error?.statusCode].find(v => typeof v==='string' && /^[A-Z][A-Z0-9_]{2,70}$/.test(v));
  const suffix = Number.isFinite(status) && status >= 400 ? `（HTTP ${status}）` : code ? `（${code}）` : '';
  if(error?.name==='QuotaExceededError') return '本机存储空间不足，请释放设备空间或登录云端保存。';
  let message;
  if(error?.name==='CloudConflict') return error.message;
  if(status===413 || /entity.?too.?large|payload.?too.?large|file.?size|exceed.*size/i.test(detail)) message='云端拒绝了文件大小，请改用快速压缩后重试';
  else if(status===401 || /token.*expired|unauthorized|not.*authenticated/i.test(detail)) message='登录状态已过期，请重新登录后再试';
  else if(status===403 || /permission|row.level|policy|forbidden|access.denied/i.test(detail)) message='云端拒绝了访问，请检查账号权限或云服务状态';
  else if(status===402 || /quota|resource.*exhaust|arrear|欠费|额度|capacity/i.test(detail)) message='云服务额度或存储容量不足，请检查腾讯云用量';
  else if(status===429 || /rate.limit|too.many/i.test(detail)) message='请求过于频繁，请稍等一会再试';
  else if(/timeout|timed.out|超时|AbortError/i.test(detail) || [408,504].includes(status)) message='上传连接超时，请保持页面在前台并换稳定网络后重试';
  else if(/network|fetch|offline|connection|unreachable/i.test(detail) || status===0) message='上传连接中断，请保持页面在前台并换稳定网络后重试';
  else if(status>=500) message='云端服务暂时异常，请稍后重试';
  else if(error?.name==='QuotaExceededError') message='本机存储空间不足，请释放设备空间或登录云端保存';
  else message=error?.stage==='metadata'?'视频已传输，但线路信息保存失败，请稍后重试':'文件上传失败，请稍后重试';
  return message + suffix + '。';
}
export function retryableUploadError(error) {
  const status=Number(error?.status || error?.statusCode);
  if([400,401,402,403,404,409,413,415,422].includes(status))return false;
  return !/quota|permission|policy|exceed.*size|file.?size|invalid|mime/i.test([error?.code,error?.message].join(' '));
}
