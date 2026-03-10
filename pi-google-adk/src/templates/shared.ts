/**
 * Shared template content used across all scaffold types.
 */

export function gitignore(): string {
  return `.env
.venv/
__pycache__/
*.py[cod]
*$py.class
*.egg-info/
dist/
build/
.eggs/
*.egg
`;
}
