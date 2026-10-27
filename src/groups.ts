export const GROUP_MAX_LENGTH = 32;

export type SectionKind = "all" | "pinned" | "group" | "none";

export interface SectionRef {
  kind: SectionKind;
  key: string;
}

export interface EntrySection extends SectionRef {
  name: string;
  entries: OTPEntryInterface[];
}

interface SplitSections {
  pinned: OTPEntryInterface[];
  groups: EntrySection[];
  none: OTPEntryInterface[];
}

export function normalizeGroup(name: unknown) {
  return typeof name === "string" ? name.trim().normalize("NFC") : "";
}

export function groupKey(name: unknown) {
  return normalizeGroup(name).toLowerCase();
}

export function entryGroupKey(entry: OTPEntryInterface) {
  return entry.secret === null ? "" : groupKey(entry.group);
}

function groupSection(key: string, name: string): EntrySection {
  return { kind: "group", key, name, entries: [] };
}

function split(entries: OTPEntryInterface[]): SplitSections {
  const pinned: OTPEntryInterface[] = [];
  const groups = new Map<string, EntrySection>();
  const none: OTPEntryInterface[] = [];
  for (const entry of entries) {
    if (entry.pinned) {
      pinned.push(entry);
      continue;
    }
    const key = entryGroupKey(entry);
    if (!key) {
      none.push(entry);
      continue;
    }
    let section = groups.get(key);
    if (!section) {
      section = groupSection(key, normalizeGroup(entry.group));
      groups.set(key, section);
    }
    section.entries.push(entry);
  }
  return { pinned, groups: [...groups.values()], none };
}

function join({ pinned, groups, none }: SplitSections) {
  return [...pinned, ...groups.flatMap((section) => section.entries), ...none];
}

function place(
  sections: SplitSections,
  entry: OTPEntryInterface,
  first: boolean,
) {
  const key = groupKey(entry.group);
  let entries = sections.none;
  if (key) {
    let section = sections.groups.find((item) => item.key === key);
    if (!section) {
      section = groupSection(key, normalizeGroup(entry.group));
      sections.groups.push(section);
    }
    entries = section.entries;
  }
  if (first) {
    entries.unshift(entry);
  } else {
    entries.push(entry);
  }
}

export function buildSections(entries: OTPEntryInterface[]): EntrySection[] {
  const { pinned, groups, none } = split(entries);
  if (!groups.length) {
    return [{ kind: "all", key: "", name: "", entries: [...pinned, ...none] }];
  }
  return [
    { kind: "pinned", key: "", name: "", entries: pinned },
    ...groups,
    { kind: "none", key: "", name: "", entries: none },
  ];
}

export function isGrouped(sections: EntrySection[]) {
  return sections[0]?.kind !== "all";
}

export function sameSection(a: SectionRef, b: SectionRef) {
  return a.kind === b.kind && a.key === b.key;
}

function others(entries: OTPEntryInterface[], entry: OTPEntryInterface) {
  return entries.filter((item) => item.hash !== entry.hash);
}

export function sectionOf(
  sections: EntrySection[],
  entry: OTPEntryInterface,
): SectionRef | undefined {
  const section = sections.find((item) =>
    item.entries.some((other) => other.hash === entry.hash),
  );
  return section && { kind: section.kind, key: section.key };
}

export function groupLabels(entries: OTPEntryInterface[]) {
  const labels = new Map<string, string>();
  for (const section of split(entries).groups) {
    labels.set(section.key, section.name);
  }
  for (const entry of entries) {
    const key = entryGroupKey(entry);
    if (key && !labels.has(key)) {
      labels.set(key, normalizeGroup(entry.group));
    }
  }
  return labels;
}

export function resolveGroup(entries: OTPEntryInterface[], name: unknown) {
  const label = normalizeGroup(name);
  return groupLabels(entries).get(label.toLowerCase()) ?? label;
}

export function arrangeEntries(
  entries: OTPEntryInterface[],
  preferred = new Map<string, string>(),
) {
  const labels = new Map([...groupLabels(entries), ...preferred]);
  for (const entry of entries) {
    const key = entryGroupKey(entry);
    if (key) {
      entry.group = labels.get(key) as string;
    }
  }
  const sections = split(entries);
  return sections.groups.length ? join(sections) : [...entries];
}

export function mergeTarget(
  entries: OTPEntryInterface[],
  key: string,
  name: string,
) {
  const newKey = groupKey(name);
  return newKey && newKey !== key
    ? groupLabels(entries).get(newKey)
    : undefined;
}

export function setEntryGroup(
  entries: OTPEntryInterface[],
  entry: OTPEntryInterface,
  name: string,
) {
  const label = resolveGroup(entries, name);
  if (entry.secret === null || entry.group === label) {
    return null;
  }
  const sameGroup = entryGroupKey(entry) === groupKey(label);
  entry.group = label;
  if (entry.pinned || sameGroup) {
    return [...entries];
  }
  const sections = split(others(entries, entry));
  place(sections, entry, false);
  return join(sections);
}

export function insertEntry(
  entries: OTPEntryInterface[],
  entry: OTPEntryInterface,
) {
  entry.group = resolveGroup(entries, entry.group);
  const sections = split(entries);
  if (!sections.groups.length && !groupKey(entry.group)) {
    return [entry, ...entries];
  }
  place(sections, entry, true);
  return join(sections);
}

export function togglePin(
  entries: OTPEntryInterface[],
  entry: OTPEntryInterface,
) {
  entry.pinned = !entry.pinned;
  const sections = split(others(entries, entry));
  if (entry.pinned) {
    if (!split(entries).groups.length) {
      return [...entries];
    }
    sections.pinned.push(entry);
  } else {
    if (!sections.groups.length && !entryGroupKey(entry)) {
      return [...entries];
    }
    place(sections, entry, true);
  }
  return join(sections);
}

export function renameGroup(
  entries: OTPEntryInterface[],
  key: string,
  name: string,
) {
  const label = normalizeGroup(name);
  if (!label) {
    return null;
  }
  const target = mergeTarget(entries, key, label);
  const sections = split(entries);
  for (const entry of entries) {
    if (entryGroupKey(entry) === key) {
      entry.group = target ?? label;
    }
  }
  const into = sections.groups.find(
    (section) => section.key === groupKey(target),
  );
  const index = sections.groups.findIndex((section) => section.key === key);
  if (into && index !== -1) {
    into.entries.push(...sections.groups.splice(index, 1)[0].entries);
  }
  return join(sections);
}

export function ungroup(entries: OTPEntryInterface[], key: string) {
  const sections = split(entries);
  const index = sections.groups.findIndex((section) => section.key === key);
  if (index !== -1) {
    sections.none.unshift(...sections.groups.splice(index, 1)[0].entries);
  }
  for (const entry of entries) {
    if (entryGroupKey(entry) === key) {
      entry.group = "";
    }
  }
  return join(sections);
}

export function moveEntry(
  entries: OTPEntryInterface[],
  entry: OTPEntryInterface,
  to: SectionRef,
  newIndex: number,
) {
  const sections = buildSections(entries);
  const from = sectionOf(sections, entry);
  const source = sections.find((section) => from && sameSection(section, from));
  const target = sections.find((section) => sameSection(section, to));
  if (!source || !target) {
    return null;
  }
  if (entry.secret === null && source !== target) {
    return null;
  }
  source.entries.splice(
    source.entries.findIndex((item) => item.hash === entry.hash),
    1,
  );
  target.entries.splice(newIndex, 0, entry);
  if (target.kind === "all") {
    return [
      ...target.entries.filter((item) => item.pinned),
      ...target.entries.filter((item) => !item.pinned),
    ];
  }
  if (target.kind === "pinned") {
    entry.pinned = true;
  } else {
    entry.pinned = false;
    entry.group = target.kind === "group" ? target.name : "";
  }
  return sections.flatMap((section) => section.entries);
}

export function moveGroup(
  entries: OTPEntryInterface[],
  key: string,
  newIndex: number,
) {
  const sections = split(entries);
  const index = sections.groups.findIndex((section) => section.key === key);
  if (index === -1) {
    return null;
  }
  sections.groups.splice(newIndex, 0, ...sections.groups.splice(index, 1));
  return join(sections);
}

export function collapsedSections(
  sections: EntrySection[],
  collapsed: string[],
): SectionRef[] {
  return sections
    .filter(
      (section) =>
        section.kind !== "all" &&
        section.entries.length > 0 &&
        collapsed.includes(section.entries[0].hash),
    )
    .map(({ kind, key }) => ({ kind, key }));
}

export function collapsedHashes(sections: EntrySection[], refs: SectionRef[]) {
  const hashes: string[] = [];
  for (const ref of refs) {
    const section = sections.find((item) => sameSection(item, ref));
    if (section?.entries.length) {
      hashes.push(section.entries[0].hash);
    }
  }
  return hashes;
}
