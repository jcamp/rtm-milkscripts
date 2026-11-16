# Project and Subtask Report

A script for [Remember The Milk MilkScript](https://www.rememberthemilk.com/services/milkscript/).

[`project-report.js`](project-report.js) is an **unchanged copy of the working RTM script** supplied by the author. It reports incomplete projects and recursively nested subtasks, together with overdue standalone tasks.

The report includes a summary of overdue main tasks and overdue subtasks, shows source list names and links to each task, and preserves the original subtask hierarchy and order. Overdue standalone tasks appear first, followed by projects ordered by the earliest overdue date in the project. Other projects follow alphabetically.

The script creates or reuses one report task in a configured RTM list. The report task's title carries the report date. A separate dated note is kept for each day, and subsequent runs on the same day update that day's note. The note heading includes the run time.

### Installation

1. In RTM, open **MilkScript** and create a script.
2. Paste the **entire contents** of [`project-report.js`](project-report.js) into the MilkScript editor.
3. Set these constants near the top as needed:

   ```javascript
   const REPORT_NAME = 'Overdue Project Report';
   const DESTINATION_LIST_NAME = 'Inbox';
   ```

   The destination is the exact name of an existing RTM list, not a numeric ID.
4. Create **two string input parameters**, using these names exactly:

   | Parameter name | Valid values | Default in script |
   | --- | --- | --- |
   | `Project mode (ALL or OVERDUE)` | `ALL`, `OVERDUE` | `OVERDUE` |
   | `Report format (MARKDOWN or PLAIN)` | `MARKDOWN`, `PLAIN` | `MARKDOWN` |

5. Save and run the MilkScript manually. RTM presents string parameters as text boxes rather than dropdowns. Values are case-insensitive, and leading/trailing spaces are ignored. If RTM requires a value in each input, type your choices instead of leaving them blank.

### Report modes

- `ALL` includes every top-level task with an incomplete direct subtask, along with all overdue standalone tasks.
- `OVERDUE` includes projects whose parent or any incomplete descendant is overdue, along with all overdue standalone tasks. It includes the remaining incomplete descendants of each qualifying project for context.

A completed task is not included. A date-only due date becomes overdue the following day, while a task with a due time becomes overdue after that time passes. A top-level task without any incomplete direct subtasks is treated as standalone, even if it has completed subtasks.

### Output formats

- `MARKDOWN` produces compact summaries, bold names or overdue labels, nested bullets and linked task names.
- `PLAIN` produces simple indented text with task URLs on separate lines.

When copying Markdown from RTM into another editor, **Ctrl+Shift+V** (paste as plain text) may be needed to preserve the literal Markdown syntax.

See [`example-report.md`](example-report.md) for an illustrative report using fictional tasks.

### Safety and limitations

- The script does not change source tasks. It changes only the report task title and its notes.
- It validates input settings and task data, detects duplicate report tasks and daily notes, checks for circular task hierarchies and applies report size limits.
- RTM writes are not guaranteed to be atomic. If a task or note operation fails partway through, an earlier write may have succeeded.
- The default report task name is `Overdue Project Report`. To preserve reports from an earlier version, use that existing base name.
- No scheduled run is configured. You choose when to run it.

### Testing

The included script is the supplied working RTM version, unchanged. It has been used in RTM, but this GitHub copy has **not** been independently run in another RTM account. No external automated test suite is claimed for this copy. Test it with your own lists before relying on its output.

## Licence

[MIT](LICENSE).
