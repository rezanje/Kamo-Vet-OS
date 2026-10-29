// Worker pengurai kartu medis. Lihat impor-rekam-medis-urai.ts untuk protokolnya.
import { tanganiUraiRekamMedis, type PermintaanUraiRekamMedis, type JawabanUraiRekamMedis } from "./impor-rekam-medis-urai";

type LingkupWorker = { onmessage: ((event: { data: PermintaanUraiRekamMedis }) => void) | null; postMessage(pesan: JawabanUraiRekamMedis): void };

const pekerja = self as unknown as LingkupWorker;

pekerja.onmessage = (event) => {
  void tanganiUraiRekamMedis(event.data).then((jawaban) => pekerja.postMessage(jawaban));
};
