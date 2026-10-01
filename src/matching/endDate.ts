import { endDateState, ongoingCaption, type EndDateRecord } from '../profile/facts';
import type { FieldDescriptor } from '../shared/types';

export function resolveEndDate(record: EndDateRecord, field: FieldDescriptor): { value?: string; ongoing: boolean; reason: string } {
  const state = endDateState(record);
  if (state === 'known') return { value: record.endDate, ongoing: false, reason: '读取已保存的结束日期。' };
  if (state !== 'ongoing') return { ongoing: false, reason: '结束时间尚未明确或不适用，不能推算至今或具体日期。' };
  if (!['select', 'radio'].includes(field.kind)) return { ongoing: true, reason: '该控件没有已核验的至今选项，不能把进行中改成今天。' };
  const options = field.options.filter(option => !option.disabled && option.value !== '' && ongoingCaption(option.label));
  if (options.length !== 1) return { ongoing: true, reason: '网页没有唯一可用的至今选项，需要人工处理。' };
  return { value: options[0]!.label, ongoing: true, reason: '档案已确认进行中，网页有唯一可见的至今选项。' };
}
