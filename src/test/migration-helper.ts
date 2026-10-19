export const SECRET_BYTES = [
  0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef,
];

function varint(value: number) {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return bytes;
}

export function field(fieldNumber: number, value: number | number[] | string) {
  if (typeof value === "number") {
    return [...varint(fieldNumber * 8), ...varint(value)];
  }
  const bytes =
    typeof value === "string"
      ? Array.from(new TextEncoder().encode(value))
      : value;
  return [...varint(fieldNumber * 8 + 2), ...varint(bytes.length), ...bytes];
}

export function account(
  options: {
    secret?: number[];
    name?: string;
    issuer?: string;
    algorithm?: number;
    digits?: number;
    type?: number;
    counter?: number;
  } = {},
) {
  const secret = options.secret ?? SECRET_BYTES;
  return [
    ...(secret.length ? field(1, secret) : []),
    ...(options.name !== undefined ? field(2, options.name) : []),
    ...(options.issuer !== undefined ? field(3, options.issuer) : []),
    ...field(4, options.algorithm ?? 1),
    ...field(5, options.digits ?? 1),
    ...field(6, options.type ?? 2),
    ...(options.counter !== undefined ? field(7, options.counter) : []),
  ];
}

export function payload(...accounts: number[][]) {
  let bytes: number[] = [];
  for (const item of accounts) {
    bytes = bytes.concat(field(1, item));
  }
  return bytes.concat(field(2, 1), field(3, 1), field(4, 0), field(5, 12345));
}

export function migrationUri(bytes: number[]) {
  const base64 = btoa(String.fromCharCode(...bytes));
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}
