import { z } from 'zod';

export const profileUrlSchema = z.string().max(2_000).refine(value => {
  if (value === '') return true;
  try {
    const url = new URL(value);
    const unsafeCharacter = [...value].some(character => /\s/u.test(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    return !unsafeCharacter && /^https?:\/\//iu.test(value) && ['http:', 'https:'].includes(url.protocol)
      && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}, '链接须为完整 http/https 网页地址，不接受脚本、文件或认证信息').optional();
