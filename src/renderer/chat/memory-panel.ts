import type {
  MemoryCandidateRecord,
  MemoryRecord,
  MemoryReviewReason,
  MemoryType,
} from '../../core/memory/contracts';
import {
  AUTOMATIC_MEMORY_BATCH_MESSAGES,
  AUTOMATIC_MEMORY_MAX_CANDIDATES,
  AUTOMATIC_MEMORY_MIN_CONFIDENCE,
  AUTOMATIC_MEMORY_MIN_IMPORTANCE,
} from '../../core/memory/memory-policy';
import type { DeskpetApi } from '../../shared/ipc';
import type { MemorySettings } from '../../shared/memory-ipc';
import { el, createButton, createField } from './elements';
import { createPanelLifetime } from './panel-lifetime';

interface MemoryPanelOptions {
  api:
    | Pick<
        DeskpetApi,
        | 'updateMemoryCandidate'
        | 'mergeMemoryCandidates'
        | 'confirmMemoryCandidate'
        | 'rejectMemoryCandidate'
        | 'updateMemory'
        | 'deleteMemory'
        | 'setMemorySettings'
        | 'exportMemories'
        | 'backupMemory'
        | 'clearMemories'
      >
    | undefined;
  getRecords(): readonly MemoryRecord[];
  getCandidates(): readonly MemoryCandidateRecord[];
  reload(): Promise<void>;
  confirm?: (message: string) => boolean;
}

const formatLocalDateTime = (timestamp?: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const readFutureExpiration = (
  input: HTMLInputElement,
): { ok: true; expiresAt?: number } | { ok: false } => {
  if (!input.value) return { ok: true };
  const expiresAt = new Date(input.value).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
    ? { ok: true, expiresAt }
    : { ok: false };
};

export const mountMemoryPanel = (options: MemoryPanelOptions) => {
  const { api, reload: loadMemories } = options;
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  const lifetime = createPanelLifetime();
  let renderLifetime = createPanelLifetime();
  const exportMemoryButton = createButton('导出', 'text-button');
  const backupMemoryButton = createButton('备份', 'text-button');
  const memoryControls = el('div', { className: 'memory-controls' });
  const automaticMemoryInput = el('input', { type: 'checkbox' });
  const automaticMemoryLabel = el('label', { className: 'memory-toggle' });
  automaticMemoryLabel.append(automaticMemoryInput, document.createTextNode(' 自动提取'));
  const memoryFilter = el('select', { attrs: { 'aria-label': '记忆分类' } });
  for (const [value, label] of [
    ['', '全部分类'],
    ['preference', '偏好'],
    ['person', '人物关系'],
    ['event', '事件'],
    ['plan', '计划'],
    ['fact', '事实'],
  ]) {
    const option = el('option', { value: value, textContent: label });
    memoryFilter.append(option);
  }
  const clearMemoriesButton = createButton('清空全部', 'text-button danger-button');
  memoryControls.append(automaticMemoryLabel, memoryFilter, clearMemoriesButton);
  const memoryStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  const automaticPolicy = el('details', { className: 'memory-policy' });
  const automaticPolicyTitle = el('summary', { textContent: '自动提取按什么判断？' });
  const automaticPolicyIntro = document.createElement('p');
  automaticPolicyIntro.textContent = `开启后，每累计约 ${AUTOMATIC_MEMORY_BATCH_MESSAGES / 2} 轮完整对话，模型会在后台提出最多 ${AUTOMATIC_MEMORY_MAX_CANDIDATES} 条候选。候选不会直接生效。`;
  const automaticPolicyRules = document.createElement('ul');
  for (const rule of [
    '只考虑稳定偏好、人物关系、重要事件、计划目标和明确事实。',
    `本地规则要求重要度至少 ${AUTOMATIC_MEMORY_MIN_IMPORTANCE}、置信度至少 ${AUTOMATIC_MEMORY_MIN_CONFIDENCE}，并且必须能对应到真实用户消息。`,
    '寒暄、玩笑、推测、密码或 API Key 会被忽略；偏好、习惯、关系、冲突和时间不明确的未来事件必须由你确认。',
  ]) {
    const item = el('li', { textContent: rule });
    automaticPolicyRules.append(item);
  }
  automaticPolicy.append(automaticPolicyTitle, automaticPolicyIntro, automaticPolicyRules);
  const memoryIndexSettings = el('details', { className: 'memory-policy' });
  const memoryIndexSummary = el('summary', { textContent: '混合记忆索引（可选）' });
  const semanticIndexSelect = document.createElement('select');
  for (const [value, label] of [
    ['local', '本机向量（默认）'],
    ['qdrant', 'Qdrant'],
  ]) {
    const option = el('option', { value: value, textContent: label });
    semanticIndexSelect.append(option);
  }
  const relationshipIndexSelect = document.createElement('select');
  for (const [value, label] of [
    ['local', '本机关系（默认）'],
    ['neo4j', 'Neo4j'],
  ]) {
    const option = el('option', { value: value, textContent: label });
    relationshipIndexSelect.append(option);
  }
  const qdrantUrlInput = el('input', { type: 'url', maxLength: 2_048 });
  const qdrantCollectionInput = el('input', { maxLength: 64 });
  const qdrantApiKeyInput = document.createElement('input');
  qdrantApiKeyInput.type = 'password';
  qdrantApiKeyInput.maxLength = 32_768;
  qdrantApiKeyInput.placeholder = '留空保留已保存密钥';
  const neo4jUrlInput = el('input', { type: 'url', maxLength: 2_048 });
  const neo4jDatabaseInput = el('input', { maxLength: 64 });
  const neo4jUsernameInput = el('input', { maxLength: 128 });
  const neo4jPasswordInput = document.createElement('input');
  neo4jPasswordInput.type = 'password';
  neo4jPasswordInput.maxLength = 32_768;
  neo4jPasswordInput.placeholder = '留空保留已保存密码';
  const saveMemoryIndexesButton = createButton('保存索引设置', 'secondary-button');
  const memoryIndexHint = el('p', { className: 'settings-status' });
  memoryIndexHint.textContent =
    '外部索引默认关闭。启用时会发送向量或关系词与随机记忆 ID，不把外部服务当作唯一正文；断线会自动回退关键词。只允许 HTTPS 或本机 HTTP。';
  memoryIndexSettings.append(
    memoryIndexSummary,
    memoryIndexHint,
    createField('语义索引', semanticIndexSelect),
    createField('Qdrant 地址', qdrantUrlInput),
    createField('Qdrant 集合', qdrantCollectionInput),
    createField('Qdrant API Key', qdrantApiKeyInput),
    createField('关系索引', relationshipIndexSelect),
    createField('Neo4j HTTP 地址', neo4jUrlInput),
    createField('Neo4j 数据库', neo4jDatabaseInput),
    createField('Neo4j 用户名', neo4jUsernameInput),
    createField('Neo4j 密码', neo4jPasswordInput),
    saveMemoryIndexesButton,
  );
  const candidateTitle = document.createElement('strong');
  candidateTitle.className = 'memory-section-title';
  candidateTitle.textContent = '待你确认';
  const candidateList = el('div', { className: 'memory-list memory-candidate-list' });
  const confirmedMemoryTitle = document.createElement('strong');
  confirmedMemoryTitle.className = 'memory-section-title';
  confirmedMemoryTitle.textContent = '已确认记忆';
  const memoryList = el('div', { className: 'memory-list' });
  const memoryTypeLabels: Record<MemoryType, string> = {
    preference: '偏好',
    person: '人物关系',
    event: '事件',
    plan: '计划',
    fact: '事实',
  };

  const memoryReviewLabels: Record<MemoryReviewReason, string> = {
    legacy_automatic: '旧版自动记忆，升级后等待确认',
    conflict: '与现有记忆冲突',
    time_uncertain: '未来时间还不明确',
    profile_claim: '偏好、习惯或关系信息不会自动生效',
  };

  const renderMemoryCandidates = (): void => {
    const memoryCandidates = options.getCandidates();
    candidateList.replaceChildren();
    const selectedType = memoryFilter.value;
    const filtered = selectedType
      ? memoryCandidates.filter((candidate) => candidate.type === selectedType)
      : memoryCandidates;
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '没有待确认项。自动提取会先来这里排队，不会偷偷混进聊天。';
      candidateList.append(empty);
      return;
    }
    for (const candidate of filtered) {
      const card = el('article', { className: 'memory-card memory-card--candidate' });
      const heading = el('div', { className: 'memory-candidate-heading' });
      const type = el('strong', { textContent: memoryTypeLabels[candidate.type] });
      const state = document.createElement('span');
      state.className = 'memory-badge';
      state.textContent = candidate.status === 'conflict' ? '有冲突' : '待确认';
      heading.append(type, state);
      const typeSelect = el('select', { attrs: { 'aria-label': '候选记忆分类' } });
      for (const memoryType of Object.keys(memoryTypeLabels) as MemoryType[]) {
        const option = document.createElement('option');
        option.value = memoryType;
        option.textContent = memoryTypeLabels[memoryType];
        typeSelect.append(option);
      }
      typeSelect.value = candidate.type;
      const content = document.createElement('textarea');
      content.className = 'memory-candidate-content';
      content.value = candidate.content;
      content.maxLength = 1_000;
      content.rows = 2;
      content.setAttribute('aria-label', '候选记忆内容');
      const metrics = el('div', { className: 'memory-metrics' });
      const importance = document.createElement('input');
      importance.type = 'range';
      importance.min = '0';
      importance.max = '1';
      importance.step = '0.05';
      importance.value = candidate.importance.toFixed(2);
      importance.setAttribute('aria-label', '候选重要度');
      const confidence = document.createElement('input');
      confidence.type = 'range';
      confidence.min = '0';
      confidence.max = '1';
      confidence.step = '0.05';
      confidence.value = candidate.confidence.toFixed(2);
      confidence.setAttribute('aria-label', '候选置信度');
      metrics.append(
        document.createTextNode('重要度 '),
        importance,
        document.createTextNode(' 置信度 '),
        confidence,
      );
      const expirationField = el('label', { className: 'memory-expiration' });
      const expirationLabel = el('span', { textContent: '有效期（可不填）' });
      const expiration = document.createElement('input');
      expiration.type = 'datetime-local';
      expiration.value = formatLocalDateTime(candidate.expiresAt);
      expirationField.append(expirationLabel, expiration);
      const updateExpirationVisibility = (): void => {
        expirationField.hidden = !['event', 'plan'].includes(typeSelect.value);
        if (expirationField.hidden) expiration.value = '';
      };
      updateExpirationVisibility();
      const reasons = el('p', { className: 'memory-source' });
      reasons.textContent = candidate.reviewReasons.length
        ? candidate.reviewReasons.map((reason) => memoryReviewLabels[reason]).join('；')
        : '自动提取结果，需要你点头才会生效。';
      card.append(heading, typeSelect, content, metrics, expirationField, reasons);
      if (candidate.conflictingMemory) {
        const conflict = document.createElement('p');
        conflict.className = 'memory-conflict';
        conflict.textContent = `现有记忆：${candidate.conflictingMemory.content}`;
        card.append(conflict);
      }
      const evidenceSummary = document.createElement('small');
      evidenceSummary.className = 'memory-source';
      evidenceSummary.textContent = `证据 ${candidate.evidence.length} 条，来自 ${candidate.evidenceDateCount} 个日期`;
      const evidenceList = el('ul', { className: 'memory-evidence-list' });
      for (const evidence of candidate.evidence.slice(0, 3)) {
        const item = document.createElement('li');
        const date = new Date(evidence.observedAt).toLocaleDateString();
        item.textContent = evidence.sourceExcerpt
          ? `${date} · ${evidence.sourceExcerpt}`
          : `${date} · 原消息已从对话历史清除`;
        evidenceList.append(item);
      }
      const actions = el('div', { className: 'memory-card__actions' });
      const saveDraft = createButton('保存候选修改', 'text-button');
      const confirm = createButton('确认记住', 'text-button');
      const reject = createButton('拒绝', 'text-button danger-button');
      actions.append(saveDraft, confirm, reject);
      let dirty = false;
      const markDirty = (): void => {
        dirty = true;
        saveDraft.textContent = '保存候选修改 *';
      };
      for (const control of [typeSelect, content, importance, confidence, expiration]) {
        renderLifetime.on(control, 'input', markDirty);
      }
      renderLifetime.on(typeSelect, 'change', () => {
        updateExpirationVisibility();
        markDirty();
      });
      renderLifetime.on(saveDraft, 'click', () => {
        void (async () => {
          if (lifetime.disposed || !api) return;
          if (!content.value.trim()) {
            memoryStatus.textContent = '候选内容不能为空。';
            return;
          }
          const parsedExpiration = readFutureExpiration(expiration);
          if (!parsedExpiration.ok) {
            memoryStatus.textContent = '有效期必须是将来的时间，或者留空。';
            return;
          }
          const result = await api.updateMemoryCandidate({
            id: candidate.id,
            type: typeSelect.value as MemoryType,
            content: content.value.trim(),
            importance: Number(importance.value),
            confidence: Number(confidence.value),
            ...('expiresAt' in parsedExpiration ? { expiresAt: parsedExpiration.expiresAt } : {}),
          });
          if (lifetime.disposed) return;
          memoryStatus.textContent = result.ok ? '候选修改已保存。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      let conflictResolution: HTMLSelectElement | undefined;
      if (candidate.conflictingMemory) {
        conflictResolution = document.createElement('select');
        conflictResolution.setAttribute('aria-label', '冲突处理方式');
        for (const [value, label] of [
          ['replace', '用新记忆替换旧记忆'],
          ['keep-both', '新旧两条都保留'],
        ] as const) {
          const option = el('option', { value: value, textContent: label });
          conflictResolution.append(option);
        }
        card.append(conflictResolution);
      }
      const mergeableCandidates = memoryCandidates.filter(
        (other) =>
          other.id !== candidate.id &&
          other.type === candidate.type &&
          other.normalizedKey === candidate.normalizedKey,
      );
      if (mergeableCandidates.length > 0) {
        const mergeRow = el('div', { className: 'memory-merge-row' });
        const mergeSelect = el('select', { attrs: { 'aria-label': '要合并的候选' } });
        for (const other of mergeableCandidates) {
          const option = el('option', { value: other.id, textContent: other.content.slice(0, 60) });
          mergeSelect.append(option);
        }
        const mergeButton = createButton('合并证据到本条', 'text-button');
        renderLifetime.on(mergeButton, 'click', () => {
          void (async () => {
            if (lifetime.disposed || !api) return;
            if (dirty) {
              memoryStatus.textContent = '请先保存候选修改，再合并证据。';
              return;
            }
            const result = await api.mergeMemoryCandidates({
              targetId: candidate.id,
              sourceId: mergeSelect.value,
            });
            if (lifetime.disposed) return;
            memoryStatus.textContent = result.ok ? '候选及其来源证据已合并。' : result.message;
            if (result.ok) await loadMemories();
          })();
        });
        mergeRow.append(mergeSelect, mergeButton);
        card.append(mergeRow);
      }
      renderLifetime.on(confirm, 'click', () => {
        void (async () => {
          if (lifetime.disposed || !api) return;
          if (dirty) {
            memoryStatus.textContent = '请先保存候选修改，再确认记忆。';
            return;
          }
          const result = await api.confirmMemoryCandidate({
            id: candidate.id,
            conflictResolution: conflictResolution?.value === 'keep-both' ? 'keep-both' : 'replace',
          });
          if (lifetime.disposed) return;
          memoryStatus.textContent = result.ok
            ? '候选已经确认，会在相关对话中生效。'
            : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      renderLifetime.on(reject, 'click', () => {
        void (async () => {
          if (lifetime.disposed || !api) return;
          const result = await api.rejectMemoryCandidate({ id: candidate.id });
          if (lifetime.disposed) return;
          memoryStatus.textContent = result.ok ? '候选已拒绝，不会进入长期记忆。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      card.append(evidenceSummary, evidenceList, actions);
      candidateList.append(card);
    }
  };

  const renderMemories = (): void => {
    if (lifetime.disposed) return;
    renderLifetime.dispose();
    renderLifetime = createPanelLifetime();
    const memoryRecords = options.getRecords();
    renderMemoryCandidates();
    memoryList.replaceChildren();
    const selectedType = memoryFilter.value;
    const filtered = selectedType
      ? memoryRecords.filter((memory) => memory.type === selectedType)
      : memoryRecords;
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '当前分类还没有长期记忆。你可以在对话中说“记住：……”。';
      memoryList.append(empty);
      return;
    }
    for (const memory of filtered) {
      const card = el('article', { className: 'memory-card' });
      const typeSelect = document.createElement('select');
      for (const type of Object.keys(memoryTypeLabels) as MemoryType[]) {
        const option = el('option', { value: type, textContent: memoryTypeLabels[type] });
        typeSelect.append(option);
      }
      typeSelect.value = memory.type;
      const content = document.createElement('textarea');
      content.value = memory.content;
      content.maxLength = 1_000;
      content.rows = 2;
      content.setAttribute('aria-label', '记忆内容');
      const metrics = el('div', { className: 'memory-metrics' });
      const importance = document.createElement('input');
      importance.type = 'number';
      importance.min = '0';
      importance.max = '1';
      importance.step = '0.05';
      importance.value = memory.importance.toFixed(2);
      importance.setAttribute('aria-label', '重要度');
      const confidence = document.createElement('input');
      confidence.type = 'number';
      confidence.min = '0';
      confidence.max = '1';
      confidence.step = '0.05';
      confidence.value = memory.confidence.toFixed(2);
      confidence.setAttribute('aria-label', '置信度');
      const source = el('small', { className: 'memory-source' });
      const sourceLabel =
        memory.source === 'manual'
          ? '用户主动记住'
          : memory.lastConfirmedAt
            ? '自动提取，经用户确认'
            : '自动提取';
      source.textContent = memory.sourceExcerpt
        ? '来源：' + sourceLabel + ' · ' + memory.sourceExcerpt
        : '来源：' + sourceLabel;
      metrics.append(
        document.createTextNode('重要度 '),
        importance,
        document.createTextNode(' 置信度 '),
        confidence,
      );
      const expirationField = el('label', { className: 'memory-expiration' });
      const expirationLabel = el('span', { textContent: '有效期（可不填）' });
      const expiration = document.createElement('input');
      expiration.type = 'datetime-local';
      expiration.value = formatLocalDateTime(memory.expiresAt);
      expirationField.append(expirationLabel, expiration);
      const updateExpirationVisibility = (): void => {
        expirationField.hidden = !['event', 'plan'].includes(typeSelect.value);
        if (expirationField.hidden) expiration.value = '';
      };
      updateExpirationVisibility();
      renderLifetime.on(typeSelect, 'change', updateExpirationVisibility);
      const actions = el('div', { className: 'memory-card__actions' });
      const save = createButton('保存修改', 'text-button');
      const remove = createButton('删除', 'text-button danger-button');
      actions.append(save, remove);
      renderLifetime.on(save, 'click', () => {
        void (async () => {
          if (lifetime.disposed || !api) return;
          if (!content.value.trim()) {
            memoryStatus.textContent = '记忆内容不能为空。';
            return;
          }
          const parsedExpiration = readFutureExpiration(expiration);
          if (!parsedExpiration.ok) {
            memoryStatus.textContent = '有效期必须是将来的时间，或者留空。';
            return;
          }
          const result = await api.updateMemory({
            id: memory.id,
            type: typeSelect.value as MemoryType,
            content: content.value.trim(),
            importance: Number(importance.value),
            confidence: Number(confidence.value),
            ...('expiresAt' in parsedExpiration ? { expiresAt: parsedExpiration.expiresAt } : {}),
          });
          if (lifetime.disposed) return;
          memoryStatus.textContent = result.ok ? '记忆已更新。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      renderLifetime.on(remove, 'click', () => {
        void (async () => {
          if (lifetime.disposed || !api || !confirm('确定彻底忘掉这条记忆吗？')) return;
          const result = await api.deleteMemory({ id: memory.id });
          if (lifetime.disposed) return;
          memoryStatus.textContent = result.ok ? '记忆已删除。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      card.append(typeSelect, content, metrics, expirationField, source, actions);
      memoryList.append(card);
    }
  };

  lifetime.on(memoryFilter, 'change', renderMemories);
  lifetime.on(automaticMemoryInput, 'change', () => {
    if (lifetime.disposed || !api) return;
    void api
      .setMemorySettings({
        automaticMemoryEnabled: automaticMemoryInput.checked,
        semanticIndex: semanticIndexSelect.value as 'local' | 'qdrant',
        relationshipIndex: relationshipIndexSelect.value as 'local' | 'neo4j',
        qdrantUrl: qdrantUrlInput.value,
        qdrantCollection: qdrantCollectionInput.value,
        neo4jUrl: neo4jUrlInput.value,
        neo4jDatabase: neo4jDatabaseInput.value,
        neo4jUsername: neo4jUsernameInput.value,
      })
      .then((result) => {
        if (lifetime.disposed) return;
        memoryStatus.textContent = result.ok
          ? automaticMemoryInput.checked
            ? '自动提取已开启；每累计约 10 轮在后台处理。'
            : '自动提取已关闭；主动“记住”仍然有效。'
          : result.message;
      });
  });
  lifetime.on(saveMemoryIndexesButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      memoryStatus.textContent = '正在保存混合记忆索引设置…';
      const result = await api.setMemorySettings({
        automaticMemoryEnabled: automaticMemoryInput.checked,
        semanticIndex: semanticIndexSelect.value as 'local' | 'qdrant',
        relationshipIndex: relationshipIndexSelect.value as 'local' | 'neo4j',
        qdrantUrl: qdrantUrlInput.value.trim(),
        qdrantCollection: qdrantCollectionInput.value.trim(),
        ...(qdrantApiKeyInput.value ? { qdrantApiKey: qdrantApiKeyInput.value } : {}),
        neo4jUrl: neo4jUrlInput.value.trim(),
        neo4jDatabase: neo4jDatabaseInput.value.trim(),
        neo4jUsername: neo4jUsernameInput.value.trim(),
        ...(neo4jPasswordInput.value ? { neo4jPassword: neo4jPasswordInput.value } : {}),
      });
      if (lifetime.disposed) return;
      memoryStatus.textContent = result.ok
        ? '混合记忆索引设置已保存；连接失败时会自动回退关键词。'
        : result.message;
      if (result.ok) {
        qdrantApiKeyInput.value = '';
        neo4jPasswordInput.value = '';
        await loadMemories();
      }
    })();
  });
  lifetime.on(exportMemoryButton, 'click', () => {
    if (lifetime.disposed || !api) return;
    void api.exportMemories().then((result) => {
      if (lifetime.disposed) return;
      memoryStatus.textContent = result.ok
        ? result.canceled
          ? '已取消导出。'
          : '记忆 JSON 已导出。'
        : result.message;
    });
  });
  lifetime.on(backupMemoryButton, 'click', () => {
    if (lifetime.disposed || !api) return;
    void api.backupMemory().then((result) => {
      if (lifetime.disposed) return;
      memoryStatus.textContent = result.ok
        ? result.canceled
          ? '已取消备份。'
          : '本地数据库已备份。'
        : result.message;
    });
  });
  lifetime.on(clearMemoriesButton, 'click', () => {
    void (async () => {
      if (
        lifetime.disposed ||
        !api ||
        !confirm('确定清空全部长期记忆吗？此操作无法撤销，对话历史不会被清空。')
      ) {
        return;
      }
      const result = await api.clearMemories();
      if (lifetime.disposed) return;
      memoryStatus.textContent = result.ok ? '全部长期记忆已清空。' : result.message;
      if (result.ok) await loadMemories();
    })();
  });

  return {
    elements: {
      exportMemoryButton,
      backupMemoryButton,
      memoryControls,
      memoryStatus,
      automaticPolicy,
      memoryIndexSettings,
      candidateTitle,
      candidateList,
      confirmedMemoryTitle,
      memoryList,
    },
    render: renderMemories,
    showSettings(settings: MemorySettings): void {
      if (lifetime.disposed) return;
      automaticMemoryInput.checked = settings.automaticMemoryEnabled;
      semanticIndexSelect.value = settings.semanticIndex;
      relationshipIndexSelect.value = settings.relationshipIndex;
      qdrantUrlInput.value = settings.qdrantUrl;
      qdrantCollectionInput.value = settings.qdrantCollection;
      qdrantApiKeyInput.placeholder = settings.qdrantApiKeySaved
        ? '已安全保存；留空保留'
        : '可留空';
      neo4jUrlInput.value = settings.neo4jUrl;
      neo4jDatabaseInput.value = settings.neo4jDatabase;
      neo4jUsernameInput.value = settings.neo4jUsername;
      neo4jPasswordInput.placeholder = settings.neo4jPasswordSaved
        ? '已安全保存；留空保留'
        : '可留空';
    },
    dispose(): void {
      lifetime.dispose();
      renderLifetime.dispose();
      qdrantApiKeyInput.value = '';
      neo4jPasswordInput.value = '';
    },
  };
};
