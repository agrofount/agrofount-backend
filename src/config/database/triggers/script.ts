import * as path from 'path';
import * as fs from 'fs';

export const setupTriggers = async () => {
  const triggersDir = path.join(__dirname, 'triggers');
  const triggerFiles = fs.readdirSync(triggersDir);

  for (const file of triggerFiles) {
    const filePath = path.join(triggersDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Executed trigger script: ${file}`);
  }
};
