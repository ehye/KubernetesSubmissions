import { createReadingTodo, loadReadingTodoConfig } from './reading-todo.js';

try {
  const text = await createReadingTodo(loadReadingTodoConfig(process.env));
  console.log(`Created todo: ${text}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
