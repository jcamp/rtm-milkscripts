/*
 * Project and Subtask Report
 *
 * PURPOSE
 *   List projects and incomplete subtasks at any nesting depth.
 *   Also list overdue standalone top-level tasks ahead of projects.
 *   Summary separates overdue top-level tasks and overdue subtasks.
 *   Show RTM list names, and order overdue projects by oldest overdue date.
 *   Optional filter: every project or projects where the parent
 *   or any incomplete descendant is overdue.
 *   For qualifying projects, show ALL incomplete descendants for context.
 *   Optional format: Markdown or plain text.
 *
 * OUTPUT
 *   Keep a single report task in the named destination list.
 *   The report task retains its fixed name.
 *   Create one note per calendar day, updating that note on later runs.
 *   The note heading records the date and time of the latest run.
 *
 * SAFETY
 *   Read and validate source data before changing any note.
 *   Detect duplicate report tasks, duplicate daily notes and hierarchy cycles.
 *   Stop on errors instead of publishing an incomplete report.
 *   Never change the status or due date of source tasks.
 *
 * NOTE
 *   MilkScript cannot read the account's default-list setting.
 *   Resolve the destination by its exact name, not a numeric ID.
 */

/*
 * USER SETTINGS
 *
 * PROJECT_MODE
 *   'ALL'     = All top-level projects with incomplete direct subtasks.
 *   'OVERDUE' = Only projects where the parent OR an incomplete
 *               descendant at any nesting depth is overdue.
 *               All incomplete subtasks of matching projects are shown.
 *   Overdue standalone tasks appear in BOTH modes.
 *
 * REPORT_FORMAT
 *   'MARKDOWN' = Compact bold project titles, nested bullets and links.
 *                When pasting into another editor you may need
 *                Ctrl+Shift+V to preserve raw Markdown characters.
 *   'PLAIN'    = Indented text and URLs without Markdown characters.
 *
 * INPUT PARAMETERS
 *   Project mode (ALL or OVERDUE): enter ALL or OVERDUE.
 *   Report format (MARKDOWN or PLAIN): enter MARKDOWN or PLAIN.
 *   Both are free-text input fields, not dropdowns.
 *   If left empty or omitted, the defaults below are used.
 *
 * To restore fixed settings, comment out the active declarations and
 * uncomment these two lines:
 *
 * const PROJECT_MODE = 'OVERDUE';
 * const REPORT_FORMAT = 'MARKDOWN';
 */
const PROJECT_MODE = String(rtm.args['Project mode (ALL or OVERDUE)'] || 'OVERDUE')
  .trim().toUpperCase();
const REPORT_FORMAT = String(rtm.args['Report format (MARKDOWN or PLAIN)'] || 'MARKDOWN')
  .trim().toUpperCase();

const REPORT_NAME = 'Overdue Project Report';
const DESTINATION_LIST_NAME = 'Inbox'; // Exact RTM list name
const MAX_TASKS = 10000;
const MAX_REPORT_LENGTH = 500000;
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

/*
 * Identify the single report task, including its older undated name.
 * Only a name matching the exact dated format counts as this report.
 */
function isReportTask(task) {
  const name = task.getName();
  return name === REPORT_NAME ||
    (typeof name === 'string' &&
      name.startsWith(REPORT_NAME + ' | ') &&
      /^\d{4}-\d{2}-\d{2}$/.test(name.slice(REPORT_NAME.length + 3)));
}

function reportTaskName() {
  return REPORT_NAME;
}

/* Return a sortable date in the account's local time. */
function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid date returned by RTM.');
  }

  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function timeKey(date) {
  return String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0');
}

/* Ensure task data is valid before using it in the report. */
function taskId(task) {
  if (!task || typeof task.getId !== 'function') {
    throw new Error('RTM returned an invalid task object.');
  }
  const id = String(task.getId());
  if (!id || id === 'null' || id === 'undefined') {
    throw new Error('RTM returned a task without an ID.');
  }
  return id;
}

function subtasksOf(task) {
  const children = task.getSubtasks();
  if (!Array.isArray(children)) {
    throw new Error('Cannot read subtasks for task ' + taskId(task));
  }
  return children;
}

/* Check true overdue status, respecting RTM's timed vs date-only tasks. */
function isOverdue(task) {
  if (task.isCompleted()) return false;

  const due = task.getDueDate();
  if (due == null) return false;
  dateKey(due); // Reject invalid dates.

  return task.hasDueTime() ? due.getTime() < now.getTime() :
    due.getTime() < today.getTime();
}

/* Distinguish actual due dates from empty due-date fields. */
function dueStatus(task) {
  const due = task.getDueDate();
  if (due == null) return '[NO DUE DATE]';

  const date = dateKey(due);
  const timed = task.hasDueTime();
  const label = date + (timed ? ' ' + timeKey(due) : '');
  if (isOverdue(task)) return '[OVERDUE: ' + label + ']';
  if (date === dateKey(today)) return '[DUE TODAY: ' + label + ']';
  return '[DUE: ' + label + ']';
}

/*
 * Escape Markdown punctuation in RTM task names. Permalinks retain their
 * original value and become Markdown link destinations.
 */
function markdownName(name) {
  return name.replace(/([\\\`*_{}\[\]()#+.!>|])/g, '\\$1');
}

/*
 * Search descendants recursively for overdue incomplete tasks.
 * Active-path detection stops circular relationships before writing notes.
 * A completed task (and its completed branch) is ignored.
 */
function hasOverdueDescendant(task, active) {
  const id = taskId(task);
  if (active.has(id)) {
    throw new Error('Circular subtask hierarchy at task ' + id);
  }
  active.add(id);

  let found = false;
  subtasksOf(task).forEach(child => {
    if (child.isCompleted()) return;
    taskId(child);
    if (isOverdue(child) || hasOverdueDescendant(child, active)) {
      found = true;
    }
  });

  active.delete(id);
  return found;
}

/* Validate the settings before reading or changing any RTM notes. */
function checkSettings() {
  if (PROJECT_MODE !== 'ALL' && PROJECT_MODE !== 'OVERDUE') {
    throw new Error('Invalid PROJECT_MODE: ' + PROJECT_MODE);
  }
  if (REPORT_FORMAT !== 'MARKDOWN' && REPORT_FORMAT !== 'PLAIN') {
    throw new Error('Invalid REPORT_FORMAT: ' + REPORT_FORMAT);
  }
}

/*
 * Return the RTM list name, or fail clearly if list metadata is missing.
 * MilkScript tasks expose their owning list through getList().
 */
function listName(task) {
  if (typeof task.getList !== 'function') {
    throw new Error('Task list lookup is not supported for ' + taskId(task));
  }
  const list = task.getList();
  if (!list || typeof list.getName !== 'function') {
    throw new Error('Missing list for task ' + taskId(task));
  }
  const name = list.getName();
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Invalid list name for task ' + taskId(task));
  }
  return name;
}

/*
 * Find the earliest overdue date within a project, including its parent
 * and all incomplete descendants. The active set rejects cycles.
 */
function earliestOverdue(task, active) {
  if (task.isCompleted()) return null;
  const id = taskId(task);
  if (active.has(id)) throw new Error('Circular hierarchy at ' + id);
  active.add(id);

  let earliest = isOverdue(task) ? task.getDueDate().getTime() : null;
  subtasksOf(task).forEach(child => {
    const due = earliestOverdue(child, active);
    if (due !== null && (earliest === null || due < earliest)) {
      earliest = due;
    }
  });
  active.delete(id);
  return earliest;
}

/* Return one formatted project or subtask entry. */
function formatTask(name, link, status, depth, list) {
  // Show the owning list beside main tasks, but avoid repeating it on
  // every nested subtask (which remains in its parent's list).
  const listLabel = list ? ' (' + list + ')' : '';
  const overdue = status.startsWith('[OVERDUE:');

  if (REPORT_FORMAT === 'PLAIN') {
    const title = name + listLabel + ' ' + status;
    return '  '.repeat(depth) + (depth === 0 ? '' : '- ') +
      title + '\n' + '  '.repeat(depth + 1) + link;
  }

  // Keep only the name as the link. Use minimal bold for overdue items.
  const linkedName = '[' + markdownName(name) + '](' + link + ')';
  const suffix = (list ? ' (' + markdownName(list) + ')' : '') + ' ' +
    (overdue ? '**' + status + '**' : status);

  if (depth === 0) {
    return '**' + linkedName + '**' + suffix;
  }
  return '  '.repeat(depth - 1) + '- ' +
    (overdue ? '**' + linkedName + '**' : linkedName) + suffix;
}

/*
 * Visit each incomplete task once. The active path detects circular parent
 * references. Completed branches are excluded from this report.
 */
function addTaskLines(task, depth, seen, active, lines, counts) {
  const id = taskId(task);

  if (active.has(id)) {
    throw new Error('Circular subtask hierarchy at task ' + id);
  }
  if (seen.has(id)) {
    throw new Error('Task appears more than once in the hierarchy: ' + id);
  }
  if (task.isCompleted()) return;

  if (counts.total >= MAX_TASKS) {
    throw new Error('Safety limit reached: too many tasks in report.');
  }

  active.add(id);
  seen.add(id);

  const name = task.getName();
  const link = task.getPermalink();
  if (typeof name !== 'string' || !name.trim() ||
      typeof link !== 'string' || !link.startsWith('https://')) {
    throw new Error('Missing task name or link for task ' + id);
  }

  const status = dueStatus(task);
  lines.push(formatTask(name, link, status, depth,
    depth === 0 ? listName(task) : null));

  counts.total++;
  if (status.startsWith('[OVERDUE:')) {
    counts.overdue++;
    if (depth === 0) counts.overdueMain++;
    else counts.overdueSubtasks++;
  }
  if (status === '[NO DUE DATE]') counts.undated++;

  subtasksOf(task).forEach(child => {
    addTaskLines(child, depth + 1, seen, active, lines, counts);
  });
  active.delete(id);
}

/* Build the entire report in memory before making any changes to RTM. */
function buildReport() {
  const allTasks = rtm.getTasks('status:incomplete');
  if (!Array.isArray(allTasks)) {
    throw new Error('RTM did not return a task list.');
  }
  if (allTasks.length > MAX_TASKS) {
    throw new Error('Safety limit reached: too many source tasks.');
  }

  /*
   * A project must have at least one incomplete direct subtask.
   * Other overdue top-level tasks belong in their own section.
   * Exclude the report task itself from both sections.
   */
  const roots = allTasks.filter(task =>
    taskId(task) && task.getParent() == null &&
    !isReportTask(task)
  );

  const projects = roots.filter(task => {
    if (!subtasksOf(task).some(child => !child.isCompleted())) return false;
    return PROJECT_MODE === 'ALL' ||
      isOverdue(task) || hasOverdueDescendant(task, new Set());
  });

  const standaloneOverdue = roots.filter(task =>
    !subtasksOf(task).some(child => !child.isCompleted()) && isOverdue(task)
  );

  // Overdue standalone tasks are ordered by their due date, then name.
  standaloneOverdue.sort((a, b) => {
    const difference = a.getDueDate().getTime() - b.getDueDate().getTime();
    return difference || a.getName().localeCompare(b.getName());
  });

  /*
   * Order projects with overdue work by the earliest overdue date in the
   * entire project. Other projects follow alphabetically. Never sort
   * children, because their original RTM order must be preserved.
   */
  const earliestByProject = new Map();
  projects.forEach(project => {
    earliestByProject.set(taskId(project),
      earliestOverdue(project, new Set()));
  });

  projects.sort((a, b) => {
    const dueA = earliestByProject.get(taskId(a));
    const dueB = earliestByProject.get(taskId(b));
    if ((dueA === null) !== (dueB === null)) return dueA === null ? 1 : -1;
    if (dueA !== null && dueA !== dueB) return dueA - dueB;
    return a.getName().localeCompare(b.getName());
  });

  const sections = [];
  const standaloneLines = [];
  const counts = { total: 0, overdue: 0, overdueMain: 0,
    overdueSubtasks: 0, undated: 0 };
  const seen = new Set();

  // Standalone overdue tasks do not have any incomplete direct subtasks.
  standaloneOverdue.forEach(task => {
    const id = taskId(task);
    if (seen.has(id)) throw new Error('Task counted twice: ' + id);
    seen.add(id);
    if (counts.total >= MAX_TASKS) {
      throw new Error('Safety limit reached: too many report tasks.');
    }

    const name = task.getName();
    const link = task.getPermalink();
    if (typeof name !== 'string' || !name.trim() ||
        typeof link !== 'string' || !link.startsWith('https://')) {
      throw new Error('Missing task name or link for task ' + id);
    }

    const status = dueStatus(task);
    standaloneLines.push(formatTask(name, link, status, 1, listName(task)));
    counts.total++;
    counts.overdue++;
    counts.overdueMain++;
  });

  projects.forEach(project => {
    const lines = [];
    addTaskLines(project, 0, seen, new Set(), lines, counts);
    if (lines.length) sections.push(lines.join('\n'));
  });

  const date = dateKey(today);
  const headerBase = 'Project report | ' + date;
  const firstLine = (REPORT_FORMAT === 'MARKDOWN' ? '# ' : '') +
    headerBase + ' ' + timeKey(now);
  const scope = PROJECT_MODE === 'ALL' ?
    'All projects' : 'Projects with overdue work';

  // These counts include the standalone overdue section and shown projects.
  const summary = REPORT_FORMAT === 'MARKDOWN' ? [
    '**Overdue main tasks:** ' + counts.overdueMain +
      ' | **Overdue subtasks:** ' + counts.overdueSubtasks +
      ' | **Total overdue:** ' + counts.overdue,
    'Projects: ' + sections.length +
      ' | Standalone overdue: ' + standaloneLines.length +
      ' | Tasks shown: ' + counts.total +
      ' | No due date: ' + counts.undated,
    '*Mode: ' + scope + ' | Format: ' + (REPORT_FORMAT === 'MARKDOWN' ? 'Markdown' : 'Plain') + '*'
  ] : [
    'Overdue main tasks: ' + counts.overdueMain +
      ' | Overdue subtasks: ' + counts.overdueSubtasks +
      ' | Total overdue: ' + counts.overdue,
    'Projects: ' + sections.length +
      ' | Standalone overdue: ' + standaloneLines.length +
      ' | Tasks shown: ' + counts.total +
      ' | No due date: ' + counts.undated,
    'Mode: ' + scope + ' | Format: ' + (REPORT_FORMAT === 'MARKDOWN' ? 'Markdown' : 'Plain')
  ];

  const blocks = [];
  if (standaloneLines.length) {
    blocks.push((REPORT_FORMAT === 'MARKDOWN' ?
      '**Overdue standalone tasks**' : 'Overdue standalone tasks') +
      '\n\n' + standaloneLines.join('\n'));
  }
  if (sections.length) {
    blocks.push((REPORT_FORMAT === 'MARKDOWN' ?
      '**Projects with subtasks**' : 'Projects with subtasks') +
      '\n\n' + sections.join('\n\n'));
  }

  const content = [
    firstLine,
    '',
    ...summary,
    '',
    blocks.length ? blocks.join('\n\n') : 'No matching tasks found.'
  ].join('\n');

  if (content.length > MAX_REPORT_LENGTH) {
    throw new Error('Report exceeds the configured maximum note length.');
  }

  return { allTasks, date, headerBase, content, counts, projects: sections.length };
}

/*
 * Match both the current timed heading and older daily headings.
 * This prevents a second note being created after upgrading the script.
 */
function isTodaysNote(note, headerBase, date) {
  const content = note.getContent();
  if (typeof content !== 'string') {
    throw new Error('RTM returned a note without readable content.');
  }
  const first = content.split('\n', 1)[0];
  return first === headerBase ||
    first.startsWith(headerBase + ' ') ||
    first === '# ' + headerBase ||
    first.startsWith('# ' + headerBase + ' ') ||
    first === 'Overdue report | ' + date ||
    first.startsWith('Overdue report | ' + date + ' ');
}

/* Update only a single daily note. Abort if duplicates would be ambiguous. */
function saveReport(result) {
  const candidates = result.allTasks.filter(task =>
    task.getParent() == null && isReportTask(task)
  );

  if (candidates.length > 1) {
    throw new Error('Multiple report tasks found. Resolve duplicates first.');
  }

  // Resolve the exact list name, failing safely if ambiguous.
  const matchingLists = rtm.getLists().filter(list =>
    list.getName() === DESTINATION_LIST_NAME
  );
  if (matchingLists.length !== 1) {
    throw new Error('Expected one destination list named "' +
      DESTINATION_LIST_NAME + '", found ' + matchingLists.length);
  }

  // Reuse existing report task to retain the previous daily notes.
  const report = candidates.length ? candidates[0] :
    matchingLists[0].addTask(reportTaskName());

  const allNotes = report.getNotes();
  if (!Array.isArray(allNotes)) {
    throw new Error('Cannot read notes on the report task.');
  }

  const matches = allNotes.filter(note =>
    isTodaysNote(note, result.headerBase, result.date)
  );
  if (matches.length > 1) {
    throw new Error('Multiple notes found for ' + result.date +
      '. No note was changed.');
  }

  if (matches.length === 1) {
    if (matches[0].getContent() !== result.content) {
      matches[0].setContent(result.content);
    }
    console.log('Updated report note: ' + result.date);
  } else {
    report.addNote(result.content);
    console.log('Created report note: ' + result.date);
  }

  // Restore the fixed report task name after updating its daily note.
  const newName = reportTaskName();
  if (report.getName() !== newName) report.setName(newName);
}

/* Let MilkScript report failures rather than silently swallowing them. */
try {
  checkSettings();
  const result = buildReport();
  saveReport(result);
  console.log('Projects: ' + result.projects +
    ', incomplete tasks: ' + result.counts.total +
    ', overdue main tasks: ' + result.counts.overdueMain +
    ', overdue subtasks: ' + result.counts.overdueSubtasks +
    ', total overdue: ' + result.counts.overdue +
    ', undated: ' + result.counts.undated);
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.log('Project report FAILED: ' + message);
  throw error;
}
