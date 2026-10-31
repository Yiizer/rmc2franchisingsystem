# RMC2 document converter

Turns proposal DOCX files into PDFs with the official LibreOffice build, running as a separate
Vercel container project (`rmc2-converter`, region sin1). The app calls it when `RMC2_CONVERTER_URL`
is set. Otherwise it uses local LibreOffice, as on this PC.

- `POST /convert`: the body is the DOCX (4 MB max), the header is `x-converter-secret`. Returns the PDF.
- `GET /health`: requires the secret. Returns the LibreOffice version.
- Converter env: `RMC2_CONVERTER_SECRET`, at least 32 characters.
- App env:
  - `RMC2_CONVERTER_URL`
  - `RMC2_CONVERTER_SECRET`
  - `RMC2_CONVERTER_BYPASS`: the Vercel protection-bypass secret for the converter project. The converter
    stays behind Vercel Authentication.
- It holds no data. Each conversion uses its own temporary folder, which is removed afterwards. Macros and
  link updates are disabled.
- To deploy, run `vercel deploy --target=preview` from this folder, which is linked to `rmc2-converter`.
