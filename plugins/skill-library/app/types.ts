export type Skill = {
  id: string;
  name: string;
  description: string | null;
  provider: string | null;
  scope: string;
  pluginId: string | null;
  filePath: string;
  manageable: boolean;
  registrySkillId: string | null;
};

export type RegistrySkill = {
  id: string;
  source: string;
  skillId: string;
  name: string;
  installs: number;
  stars: number | null;
  installUrl: string | null;
  url: string;
  topic: string | null;
  summary: string | null;
};

export type RegistryPagination = {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};
