export async function checkIsEmail(identifier: string): Promise<boolean> {
  const isEmail = identifier.includes('@');
  let email: string | undefined;
  let phone: string | undefined;

  if (isEmail) {
    email = identifier;
  } else if (/^(?:\+?[1-9]\d{1,14}|0\d{9,14})$/.test(identifier)) {
    phone = identifier;
  }

  return isEmail;
}
