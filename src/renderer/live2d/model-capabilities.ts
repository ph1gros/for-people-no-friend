import type { LocalModelManifest } from './model-manifest';

export interface Live2DModelCapabilityReport {
  motionGroups: string[];
  expressionIds: string[];
  missingStateMotions: string[];
  missingActionMotions: string[];
  missingExpressions: string[];
  lipSyncParameter?: string;
  summary: string;
}

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const inspectLive2DModelCapabilities = (
  manifest: LocalModelManifest,
  modelSettings: unknown,
): Live2DModelCapabilityReport => {
  const root = objectRecord(modelSettings);
  const references = objectRecord(root?.FileReferences);
  const motions = objectRecord(references?.Motions) ?? {};
  const motionGroups = Object.entries(motions)
    .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
    .map(([group]) => group)
    .sort();
  const expressions = Array.isArray(references?.Expressions) ? references.Expressions : [];
  const expressionIds = expressions
    .flatMap((value) => {
      const expression = objectRecord(value);
      return typeof expression?.Name === 'string' && expression.Name ? [expression.Name] : [];
    })
    .sort();
  const motionSet = new Set(motionGroups);
  const expressionSet = new Set(expressionIds);
  const missingStateMotions = Object.entries(manifest.controls.states)
    .filter(([, motion]) => motion && !motionSet.has(motion.group))
    .map(([state]) => state);
  const missingActionMotions = Object.entries(manifest.controls.actions)
    .filter(([, motion]) => !motionSet.has(motion.group))
    .map(([action]) => action);
  const missingExpressions = Object.entries(manifest.controls.emotions)
    .filter(([, expression]) => expression && !expressionSet.has(expression))
    .map(([emotion]) => emotion);
  const missing =
    missingStateMotions.length + missingActionMotions.length + missingExpressions.length;
  return {
    motionGroups,
    expressionIds,
    missingStateMotions,
    missingActionMotions,
    missingExpressions,
    ...(manifest.controls.lipSync
      ? { lipSyncParameter: manifest.controls.lipSync.mouthOpenParameter }
      : {}),
    summary: missing
      ? `Live2D 已读取，但有 ${missing} 项映射在模型中不存在，将按安全规则回退。${manifest.controls.lipSync ? ' 已声明音频口型参数。' : ' 未声明音频口型参数。'}`
      : `Live2D 能力已核对：${motionGroups.length} 个动作组，${expressionIds.length} 个表情；${manifest.controls.lipSync ? '音频口型已映射' : '未声明音频口型'}。`,
  };
};
