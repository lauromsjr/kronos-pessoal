import { google } from 'googleapis';
import { env } from '../../config/env';

// TODO (Sexta 18/04): implementar upload de documentos no Drive
// - Usar service account já existente
// - Salvar na pasta GOOGLE_DRIVE_FOLDER_ID

function getAuth() {
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
}

export async function uploadTextFile(
  _filename: string,
  _content: string
): Promise<string> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // TODO: implementar upload real
  void drive;
  throw new Error('drive.client: não implementado');
}
