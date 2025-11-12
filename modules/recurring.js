/**
 * Side Panel 반복 체크리스트 관리
 *
 * 역할:
 * - 카테고리 CRUD (생성/수정/삭제)
 * - 할일 CRUD (생성/수정/삭제/체크/순서변경)
 * - 초기화 (현재 카테고리의 모든 체크 해제)
 * - 백업/복원 (MD 파일)
 * - 현황 복사 (보고용 텍스트)
 */

import { logInfo, logWarn, logError, logDebug } from '../logger.js';
import { showToast } from './ui-utils.js';

// ===== 상수 =====
const STORAGE_KEY = 'recurringChecklists';

// ===== 데이터 구조 =====
/**
 * @typedef {Object} Category
 * @property {string} id - 카테고리 고유 ID
 * @property {string} name - 카테고리명
 * @property {number} order - 정렬 순서
 */

/**
 * @typedef {Object} Task
 * @property {string} id - 할일 고유 ID
 * @property {string} text - 할일 내용
 * @property {boolean} checked - 완료 여부
 * @property {number} order - 정렬 순서
 */

/**
 * @typedef {Object} RecurringData
 * @property {Category[]} categories - 카테고리 목록
 * @property {Object.<string, Task[]>} tasks - 카테고리별 할일 맵
 * @property {string|null} selectedCategoryId - 현재 선택된 카테고리 ID
 */

// ===== 상태 관리 =====
let recurringData = {
  categories: [],
  tasks: {},
  selectedCategoryId: null
};

let draggedTaskId = null; // 드래그 중인 할일 ID
let isInitialized = false; // 초기화 플래그 (중복 방지)

// ===== 유틸리티 =====

/**
 * UUID 생성
 * @returns {string} UUID
 */
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 현재 날짜/시간을 포맷팅
 * @returns {string} YYYY-MM-DD HH:MM
 */
function formatDateTime() {
  const now = new Date();
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now).replace(/\. /g, '-').replace('.', '');
}

// ===== 스토리지 관리 =====

/**
 * 데이터 로드
 * @returns {Promise<RecurringData>}
 */
async function loadData() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const data = result[STORAGE_KEY] || {
      categories: [],
      tasks: {},
      selectedCategoryId: null
    };

    recurringData = data;
    return recurringData;
  } catch (error) {
    logError('recurring', 'LOAD_ERROR', '데이터 로드 실패', {}, error);
    return {
      categories: [],
      tasks: {},
      selectedCategoryId: null
    };
  }
}

/**
 * 데이터 저장
 * @returns {Promise<void>}
 */
async function saveData() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: recurringData });
    logInfo('recurring', 'SAVE_SUCCESS', '데이터 저장 완료', {
      categoryCount: recurringData.categories.length
    });
  } catch (error) {
    logError('recurring', 'SAVE_ERROR', '데이터 저장 실패', {}, error);
    throw error;
  }
}

// ===== 카테고리 관리 =====

/**
 * 카테고리 추가
 * @param {string} name - 카테고리명
 * @returns {Promise<Category>}
 */
export async function addCategory(name) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('카테고리명을 입력하세요');
  }

  const newCategory = {
    id: generateId(),
    name: trimmedName,
    order: recurringData.categories.length
  };

  recurringData.categories.push(newCategory);
  recurringData.tasks[newCategory.id] = [];

  // 새로 추가된 카테고리 자동 선택
  recurringData.selectedCategoryId = newCategory.id;

  await saveData();
  return newCategory;
}

/**
 * 카테고리 수정
 * @param {string} categoryId - 카테고리 ID
 * @param {string} newName - 새 이름
 * @returns {Promise<void>}
 */
export async function updateCategory(categoryId, newName) {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error('카테고리명을 입력하세요');
  }

  const category = recurringData.categories.find((c) => c.id === categoryId);
  if (!category) {
    throw new Error('카테고리를 찾을 수 없습니다');
  }

  category.name = trimmedName;
  await saveData();
}

/**
 * 카테고리 삭제
 * @param {string} categoryId - 카테고리 ID
 * @returns {Promise<void>}
 */
export async function deleteCategory(categoryId) {
  const index = recurringData.categories.findIndex((c) => c.id === categoryId);
  if (index === -1) {
    throw new Error('카테고리를 찾을 수 없습니다');
  }

  // 카테고리 삭제
  recurringData.categories.splice(index, 1);

  // 연관 할일 삭제
  delete recurringData.tasks[categoryId];

  // 선택된 카테고리였다면 다른 카테고리 선택
  if (recurringData.selectedCategoryId === categoryId) {
    recurringData.selectedCategoryId = recurringData.categories.length > 0
      ? recurringData.categories[0].id
      : null;
  }

  await saveData();
}

/**
 * 카테고리 선택
 * @param {string} categoryId - 카테고리 ID
 * @returns {Promise<void>}
 */
export async function selectCategory(categoryId) {
  recurringData.selectedCategoryId = categoryId;
  await saveData();
}

// ===== 할일 관리 =====

/**
 * 할일 추가
 * @param {string} categoryId - 카테고리 ID
 * @param {string} text - 할일 내용
 * @returns {Promise<Task>}
 */
export async function addTask(categoryId, text) {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('할일을 입력하세요');
  }

  const tasks = recurringData.tasks[categoryId] || [];
  const newTask = {
    id: generateId(),
    text: trimmedText,
    checked: false,
    order: tasks.length
  };

  tasks.push(newTask);
  recurringData.tasks[categoryId] = tasks;

  await saveData();
  return newTask;
}

/**
 * 할일 수정
 * @param {string} categoryId - 카테고리 ID
 * @param {string} taskId - 할일 ID
 * @param {string} newText - 새 내용
 * @returns {Promise<void>}
 */
export async function updateTask(categoryId, taskId, newText) {
  const trimmedText = newText.trim();
  if (!trimmedText) {
    throw new Error('할일을 입력하세요');
  }

  const tasks = recurringData.tasks[categoryId] || [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error('할일을 찾을 수 없습니다');
  }

  task.text = trimmedText;
  await saveData();
}

/**
 * 할일 삭제
 * @param {string} categoryId - 카테고리 ID
 * @param {string} taskId - 할일 ID
 * @returns {Promise<void>}
 */
export async function deleteTask(categoryId, taskId) {
  const tasks = recurringData.tasks[categoryId] || [];
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index === -1) {
    throw new Error('할일을 찾을 수 없습니다');
  }

  tasks.splice(index, 1);
  await saveData();
}

/**
 * 할일 체크 토글
 * @param {string} categoryId - 카테고리 ID
 * @param {string} taskId - 할일 ID
 * @returns {Promise<void>}
 */
export async function toggleTask(categoryId, taskId) {
  const tasks = recurringData.tasks[categoryId] || [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error('할일을 찾을 수 없습니다');
  }

  task.checked = !task.checked;
  await saveData();
}

/**
 * 할일 순서 변경
 * @param {string} categoryId - 카테고리 ID
 * @param {string} taskId - 할일 ID
 * @param {number} newOrder - 새 순서
 * @returns {Promise<void>}
 */
export async function reorderTask(categoryId, taskId, newOrder) {
  const tasks = recurringData.tasks[categoryId] || [];
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) {
    throw new Error('할일을 찾을 수 없습니다');
  }

  // 배열에서 제거 후 새 위치에 삽입
  const [task] = tasks.splice(taskIndex, 1);
  tasks.splice(newOrder, 0, task);

  // order 재정렬
  tasks.forEach((t, index) => {
    t.order = index;
  });

  await saveData();
}

/**
 * 현재 카테고리의 모든 할일 초기화 (체크 해제)
 * @param {string} categoryId - 카테고리 ID
 * @returns {Promise<void>}
 */
export async function resetAllTasks(categoryId) {
  const tasks = recurringData.tasks[categoryId] || [];
  tasks.forEach((task) => {
    task.checked = false;
  });

  await saveData();
}

// ===== 백업/복원 =====

/**
 * MD 파일로 백업
 * @returns {Promise<void>}
 */
export async function exportToMarkdown() {
  try {
    const lines = ['# 반복 체크리스트 백업', '', `백업 일시: ${formatDateTime()}`, ''];

    recurringData.categories.forEach((category) => {
      lines.push(`## ${category.name}`, '');

      const tasks = recurringData.tasks[category.id] || [];
      if (tasks.length === 0) {
        lines.push('*(할일 없음)*', '');
      } else {
        tasks.forEach((task) => {
          const checkbox = task.checked ? '- [x]' : '- [ ]';
          lines.push(`${checkbox} ${task.text}`);
        });
        lines.push('');
      }
    });

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const filename = `recurring-backup-${new Date().toISOString().slice(0, 10)}.md`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
    showToast('백업 파일이 다운로드되었습니다');
  } catch (error) {
    logError('recurring', 'EXPORT_ERROR', '백업 실패', {}, error);
    showToast('백업 중 오류가 발생했습니다', 'error');
  }
}

/**
 * MD 파일에서 복원
 * @param {File} file - MD 파일
 * @returns {Promise<void>}
 */
export async function importFromMarkdown(file) {
  try {
    const text = await file.text();
    const lines = text.split('\n');

    const newCategories = [];
    const newTasks = {};
    let currentCategory = null;
    let taskOrder = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // 카테고리 (## 제목)
      if (trimmed.startsWith('## ')) {
        const categoryName = trimmed.slice(3).trim();
        currentCategory = {
          id: generateId(),
          name: categoryName,
          order: newCategories.length
        };
        newCategories.push(currentCategory);
        newTasks[currentCategory.id] = [];
        taskOrder = 0;
        continue;
      }

      // 할일 (- [ ] 또는 - [x])
      if (currentCategory && (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]'))) {
        const checked = trimmed.startsWith('- [x]');
        const text = trimmed.slice(5).trim();
        if (text) {
          newTasks[currentCategory.id].push({
            id: generateId(),
            text,
            checked,
            order: taskOrder++
          });
        }
      }
    }

    // 데이터 교체
    recurringData.categories = newCategories;
    recurringData.tasks = newTasks;
    recurringData.selectedCategoryId = newCategories.length > 0 ? newCategories[0].id : null;

    await saveData();
    showToast('복원이 완료되었습니다');
  } catch (error) {
    logError('recurring', 'IMPORT_ERROR', '복원 실패', {}, error);
    showToast('복원 중 오류가 발생했습니다', 'error');
    throw error;
  }
}

// ===== 현황 복사 =====

/**
 * 현재 카테고리의 할일 상태를 텍스트로 복사
 * @param {string} categoryId - 카테고리 ID
 * @returns {Promise<void>}
 */
export async function copyStatusToClipboard(categoryId) {
  try {
    const category = recurringData.categories.find((c) => c.id === categoryId);
    if (!category) {
      throw new Error('카테고리를 찾을 수 없습니다');
    }

    const tasks = recurringData.tasks[categoryId] || [];
    const lines = [`[${category.name} - ${formatDateTime()}]`, ''];

    if (tasks.length === 0) {
      lines.push('할일 없음');
    } else {
      tasks.forEach((task, index) => {
        const checkbox = task.checked ? '✅' : '⬜';
        lines.push(`${checkbox} ${index + 1}. ${task.text}`);
      });

      const completedCount = tasks.filter((t) => t.checked).length;
      const totalCount = tasks.length;
      const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      lines.push('', `완료: ${completedCount}/${totalCount} (${percentage}%)`);
    }

    const text = lines.join('\n');
    await navigator.clipboard.writeText(text);
    showToast('현황이 클립보드에 복사되었습니다');
  } catch (error) {
    logError('recurring', 'COPY_ERROR', '현황 복사 실패', {}, error);
    showToast('복사 중 오류가 발생했습니다', 'error');
  }
}

// ===== UI 렌더링 =====

/**
 * 버튼 활성화/비활성화 상태 업데이트
 * @returns {void}
 */
function updateButtonStates() {
  const hasCategories = recurringData.categories.length > 0;
  const hasSelectedCategory = !!recurringData.selectedCategoryId;
  const hasTasks = hasSelectedCategory && (recurringData.tasks[recurringData.selectedCategoryId] || []).length > 0;

  // 카테고리 편집/삭제 버튼
  const editBtn = document.getElementById('recurringEditCategoryBtn');
  const deleteBtn = document.getElementById('recurringDeleteCategoryBtn');
  if (editBtn) editBtn.disabled = !hasSelectedCategory;
  if (deleteBtn) deleteBtn.disabled = !hasSelectedCategory;

  // 액션 버튼들
  const resetBtn = document.getElementById('recurringResetBtn');
  const backupBtn = document.getElementById('recurringBackupBtn');
  const copyBtn = document.getElementById('recurringCopyStatusBtn');
  if (resetBtn) resetBtn.disabled = !hasTasks;
  if (backupBtn) backupBtn.disabled = !hasCategories;
  if (copyBtn) copyBtn.disabled = !hasTasks;

  // 할일 입력
  const taskInput = document.getElementById('recurringTaskInput');
  const addTaskBtn = document.getElementById('recurringAddTaskBtn');
  if (taskInput) taskInput.disabled = !hasSelectedCategory;
  if (addTaskBtn) addTaskBtn.disabled = !hasSelectedCategory;

  // 카테고리 셀렉트
  const selector = document.getElementById('recurringCategorySelector');
  if (selector) selector.disabled = !hasCategories;
}

/**
 * 카테고리 선택 UI 렌더링
 * @returns {Promise<void>}
 */
async function renderCategorySelector() {
  const selector = document.getElementById('recurringCategorySelector');
  if (!selector) return;

  selector.innerHTML = '';

  if (recurringData.categories.length === 0) {
    const option = document.createElement('option');
    option.textContent = '카테고리 선택';
    option.disabled = true;
    option.selected = true;
    selector.appendChild(option);
    return;
  }

  recurringData.categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    option.selected = category.id === recurringData.selectedCategoryId;
    selector.appendChild(option);
  });
}

/**
 * 할일 목록 렌더링
 * @returns {Promise<void>}
 */
async function renderTaskList() {
  const listEl = document.getElementById('recurringTaskList');
  const emptyEl = document.getElementById('recurringEmpty');
  if (!listEl || !emptyEl) return;

  listEl.innerHTML = '';

  const categoryId = recurringData.selectedCategoryId;
  if (!categoryId) {
    emptyEl.style.display = 'flex';
    return;
  }

  const tasks = recurringData.tasks[categoryId] || [];
  if (tasks.length === 0) {
    emptyEl.style.display = 'flex';
    return;
  }

  emptyEl.style.display = 'none';

  // 순서대로 정렬
  const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);

  sortedTasks.forEach((task) => {
    const item = createTaskElement(categoryId, task);
    listEl.appendChild(item);
  });
}

/**
 * 할일 DOM 요소 생성
 * @param {string} categoryId - 카테고리 ID
 * @param {Task} task - 할일 데이터
 * @returns {HTMLDivElement}
 */
function createTaskElement(categoryId, task) {
  const item = document.createElement('div');
  item.className = 'recurring-task-item';
  item.draggable = true;
  item.dataset.taskId = task.id;

  // 드래그 이벤트
  item.addEventListener('dragstart', () => {
    draggedTaskId = task.id;
    item.classList.add('dragging');
  });

  item.addEventListener('dragend', () => {
    draggedTaskId = null;
    item.classList.remove('dragging');
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedTaskId && draggedTaskId !== task.id) {
      item.classList.add('drag-over');
    }
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over');
  });

  item.addEventListener('drop', async (e) => {
    e.preventDefault();
    item.classList.remove('drag-over');

    if (draggedTaskId && draggedTaskId !== task.id) {
      const tasks = recurringData.tasks[categoryId] || [];
      const draggedIndex = tasks.findIndex((t) => t.id === draggedTaskId);
      const targetIndex = tasks.findIndex((t) => t.id === task.id);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        try {
          await reorderTask(categoryId, draggedTaskId, targetIndex);
          await renderTaskList();
        } catch (error) {
          showToast('순서 변경 실패', 'error');
        }
      }
    }
  });

  // 순서 번호 (CSS counter 사용)
  const orderEl = document.createElement('span');
  orderEl.className = 'task-order';

  // 체크박스
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.checked;
  checkbox.className = 'task-checkbox';
  checkbox.addEventListener('change', async () => {
    try {
      await toggleTask(categoryId, task.id);
    } catch (error) {
      showToast('체크 변경 실패', 'error');
    }
  });

  // 텍스트 (클릭 시 편집 모드)
  const textEl = document.createElement('div');
  textEl.className = 'task-text';
  textEl.textContent = task.text;
  textEl.addEventListener('click', () => {
    startEditTask(textEl, categoryId, task.id);
  });

  // 삭제 버튼
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn';
  deleteBtn.title = '삭제';
  deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
  </svg>`;
  deleteBtn.addEventListener('click', async () => {
    try {
      await deleteTask(categoryId, task.id);
      await renderTaskList();
      updateButtonStates(); // 버튼 상태 업데이트
      showToast('할일이 삭제되었습니다');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  item.appendChild(orderEl);
  item.appendChild(checkbox);
  item.appendChild(textEl);
  item.appendChild(deleteBtn);

  return item;
}

/**
 * 할일 편집 모드 시작
 * @param {HTMLElement} element - 텍스트 요소
 * @param {string} categoryId - 카테고리 ID
 * @param {string} taskId - 할일 ID
 */
function startEditTask(element, categoryId, taskId) {
  const tasks = recurringData.tasks[categoryId] || [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = task.text;
  input.className = 'inline-edit-input';
  input.style.cssText = `
    background: var(--bg-primary);
    border: 1px solid var(--status-active);
    border-radius: 6px;
    padding: 4px 8px;
    color: var(--text-primary);
    font-size: 13px;
    width: 100%;
    outline: none;
  `;

  const save = async () => {
    const newText = input.value.trim();
    if (newText && newText !== task.text) {
      try {
        await updateTask(categoryId, taskId, newText);
        element.textContent = newText;
        showToast('할일이 수정되었습니다');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
    element.textContent = task.text;
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      element.textContent = task.text;
    }
  });

  element.textContent = '';
  element.appendChild(input);
  input.focus();
  input.select();
}

/**
 * UI 전체 새로고침
 * @returns {Promise<void>}
 */
async function refreshUI() {
  await renderCategorySelector();
  await renderTaskList();
  updateButtonStates();
}

// ===== 탭 초기화 =====

/**
 * 반복 체크리스트 탭 초기화
 * @returns {Promise<void>}
 */
export async function initRecurringTab() {
  // 중복 초기화 방지
  if (isInitialized) {
    await refreshUI();
    return;
  }

  await loadData();

  // 카테고리 선택 변경
  const selector = document.getElementById('recurringCategorySelector');
  if (selector) {
    selector.addEventListener('change', async (e) => {
      await selectCategory(e.target.value);
      await renderTaskList();
      updateButtonStates();
    });
  }

  // 카테고리 추가 (인라인 방식)
  const addCategoryBtn = document.getElementById('recurringAddCategoryBtn');
  const addCategoryForm = document.getElementById('recurringAddCategoryForm');
  const newCategoryInput = document.getElementById('recurringNewCategoryInput');
  const confirmAddBtn = document.getElementById('recurringConfirmAddBtn');
  const cancelAddBtn = document.getElementById('recurringCancelAddBtn');
  const categoryControls = document.querySelector('.recurring-category-controls');

  if (addCategoryBtn && addCategoryForm && newCategoryInput && confirmAddBtn && cancelAddBtn) {
    // + 버튼 클릭 → 폼 표시
    addCategoryBtn.addEventListener('click', () => {
      addCategoryForm.style.display = 'flex';
      newCategoryInput.value = '';
      newCategoryInput.focus();
    });

    // 등록 버튼
    const handleConfirmAdd = async () => {
      const name = newCategoryInput.value.trim();
      if (name) {
        try {
          await addCategory(name);
          addCategoryForm.style.display = 'none';
          await refreshUI();
          showToast('카테고리가 추가되었습니다');
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    };

    confirmAddBtn.addEventListener('click', handleConfirmAdd);

    // Enter 키
    newCategoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmAdd();
      } else if (e.key === 'Escape') {
        addCategoryForm.style.display = 'none';
      }
    });

    // 취소 버튼
    cancelAddBtn.addEventListener('click', () => {
      addCategoryForm.style.display = 'none';
    });
  }

  // 카테고리 수정 (인라인 방식)
  const editCategoryBtn = document.getElementById('recurringEditCategoryBtn');
  const editCategoryForm = document.getElementById('recurringEditCategoryForm');
  const editCategoryInput = document.getElementById('recurringEditCategoryInput');
  const confirmEditBtn = document.getElementById('recurringConfirmEditBtn');
  const cancelEditBtn = document.getElementById('recurringCancelEditBtn');

  if (editCategoryBtn && editCategoryForm && editCategoryInput && confirmEditBtn && cancelEditBtn) {
    // 편집 버튼 클릭 → 폼 표시
    editCategoryBtn.addEventListener('click', () => {
      if (!recurringData.selectedCategoryId) {
        showToast('선택된 카테고리가 없습니다', 'error');
        return;
      }

      const category = recurringData.categories.find((c) => c.id === recurringData.selectedCategoryId);
      if (!category) return;

      editCategoryForm.style.display = 'flex';
      editCategoryInput.value = category.name;
      editCategoryInput.focus();
      editCategoryInput.select();
    });

    // 수정 완료 버튼
    const handleConfirmEdit = async () => {
      const newName = editCategoryInput.value.trim();
      if (newName && newName !== '') {
        try {
          await updateCategory(recurringData.selectedCategoryId, newName);
          editCategoryForm.style.display = 'none';
          await refreshUI();
          showToast('카테고리명이 변경되었습니다');
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    };

    confirmEditBtn.addEventListener('click', handleConfirmEdit);

    // Enter 키
    editCategoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmEdit();
      } else if (e.key === 'Escape') {
        editCategoryForm.style.display = 'none';
      }
    });

    // 취소 버튼
    cancelEditBtn.addEventListener('click', () => {
      editCategoryForm.style.display = 'none';
    });
  }

  // 카테고리 삭제 (즉시 삭제)
  const deleteCategoryBtn = document.getElementById('recurringDeleteCategoryBtn');
  if (deleteCategoryBtn) {
    deleteCategoryBtn.addEventListener('click', async () => {
      if (!recurringData.selectedCategoryId) {
        showToast('선택된 카테고리가 없습니다', 'error');
        return;
      }

      try {
        await deleteCategory(recurringData.selectedCategoryId);
        await refreshUI();
        showToast('카테고리가 삭제되었습니다');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  // 할일 추가
  const addTaskBtn = document.getElementById('recurringAddTaskBtn');
  const taskInput = document.getElementById('recurringTaskInput');
  if (addTaskBtn && taskInput) {
    const handleAddTask = async () => {
      if (!recurringData.selectedCategoryId) {
        showToast('카테고리를 먼저 추가하세요', 'error');
        return;
      }

      const text = taskInput.value.trim();
      if (text) {
        try {
          await addTask(recurringData.selectedCategoryId, text);
          taskInput.value = '';
          await renderTaskList();
          updateButtonStates(); // 버튼 상태 업데이트
          showToast('할일이 추가되었습니다');
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    };

    addTaskBtn.addEventListener('click', handleAddTask);
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });
  }

  // 초기화 버튼
  const resetBtn = document.getElementById('recurringResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!recurringData.selectedCategoryId) {
        showToast('선택된 카테고리가 없습니다', 'error');
        return;
      }

      try {
        await resetAllTasks(recurringData.selectedCategoryId);
        await renderTaskList();
        showToast('모든 할일이 초기화되었습니다');
      } catch (error) {
        showToast('초기화 실패', 'error');
      }
    });
  }

  // 백업 버튼
  const backupBtn = document.getElementById('recurringBackupBtn');
  if (backupBtn) {
    backupBtn.addEventListener('click', exportToMarkdown);
  }

  // 복원 버튼
  const restoreBtn = document.getElementById('recurringRestoreBtn');
  const restoreInput = document.getElementById('recurringRestoreInput');
  if (restoreBtn && restoreInput) {
    restoreBtn.addEventListener('click', () => {
      restoreInput.click();
    });

    restoreInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          await importFromMarkdown(file);
          await refreshUI();
        } catch (error) {
          // 에러는 이미 함수 내에서 처리됨
        }
        restoreInput.value = '';
      }
    });
  }

  // 현황 복사 버튼
  const copyBtn = document.getElementById('recurringCopyStatusBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!recurringData.selectedCategoryId) {
        showToast('선택된 카테고리가 없습니다', 'error');
        return;
      }

      await copyStatusToClipboard(recurringData.selectedCategoryId);
    });
  }

  // 초기 렌더링
  await refreshUI();

  // 초기화 완료 플래그 설정
  isInitialized = true;
  logInfo('recurring', 'INIT_COMPLETE', '반복 체크리스트 탭 초기화 완료', {
    categoryCount: recurringData.categories.length
  });
}
