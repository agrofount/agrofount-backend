import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

export const setupTriggers = async (dataSource: DataSource) => {
  // Use process.cwd() for more reliable path resolution
  const possiblePaths = [
    path.join(process.cwd(), 'src/config/database/triggers'), // Dev mode
    path.join(process.cwd(), 'dist/config/database/triggers'), // Prod mode
  ];

  let triggersDir;
  for (const dir of possiblePaths) {
    if (fs.existsSync(dir)) {
      triggersDir = dir;
      break;
    }
  }

  if (!triggersDir) {
    throw new Error(`Triggers directory not found in either:
    - ${possiblePaths[0]}
    - ${possiblePaths[1]}`);
  }

  // if (!fs.existsSync(triggersDir)) {
  //   throw new Error(`Triggers directory not found at: ${triggersDir}`);
  // }

  const files = fs.readdirSync(triggersDir);
  console.log(`Files found in directory:`, files);

  const triggerFiles = files.filter((file) => file.endsWith('.sql'));

  if (triggerFiles.length === 0) {
    throw new Error(
      `No SQL files found in: ${triggersDir}\nDirectory contents: ${files.join(
        ', ',
      )}`,
    );
  }

  for (const file of triggerFiles) {
    const filePath = path.join(triggersDir, file);
    console.log(`Processing trigger file: ${filePath}`);

    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      await dataSource.query(sql);
      console.log(`✅ Successfully executed trigger: ${file}`);
    } catch (error) {
      console.error(`❌ Failed to execute ${file}:`, error.message);
      throw error;
    }
  }
};
