import { expect, test } from "vitest";
import { repositoryUrl, selectReadme } from "./project-data";
test("repository links normalize SSH and remove credentials", () => {
  expect(repositoryUrl('git@github.com:jem/project.git')).toBe('https://github.com/jem/project');
  expect(repositoryUrl('ssh://git@github.com/jem/project.git')).toBe('https://github.com/jem/project');
  expect(repositoryUrl('https://token:secret@github.com/jem/project.git?token=secret#private')).toBe('https://github.com/jem/project');
  expect(repositoryUrl('javascript:alert(1)')).toBeNull(); expect(repositoryUrl('/local/repo')).toBeNull();
});
test("README selection favors root docs and never another package", () => {
  expect(selectReadme(['node_modules/pkg/README.md', 'docs/readme.md', 'README.txt', 'Readme.md'])).toBe('Readme.md');
  expect(selectReadme(['packages/core/README.md'])).toBeNull();
  expect(selectReadme(['.github/README.md'])).toBe('.github/README.md');
});
