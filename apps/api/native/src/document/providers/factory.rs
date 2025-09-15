use super::docx::DocxProvider;
use super::odt::OdtProvider;
use super::rtf::RtfProvider;
use super::DocumentProvider;
use napi_derive::napi;

#[napi]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentType {
  Docx,
  Rtf,
  Odt,
}

impl DocumentType {
  pub fn from_str(s: &str) -> Option<Self> {
    match s.to_lowercase().as_str() {
      "docx" => Some(Self::Docx),
      "rtf" => Some(Self::Rtf),
      "odt" => Some(Self::Odt),
      _ => None,
    }
  }
}

pub struct ProviderFactory {
  docx_provider: DocxProvider,
  rtf_provider: RtfProvider,
  odt_provider: OdtProvider,
}

impl ProviderFactory {
  pub fn new() -> Self {
    Self {
      docx_provider: DocxProvider::new(),
      rtf_provider: RtfProvider::new(),
      odt_provider: OdtProvider::new(),
    }
  }

  pub fn get_provider(&self, doc_type: DocumentType) -> &dyn DocumentProvider {
    match doc_type {
      DocumentType::Docx => &self.docx_provider,
      DocumentType::Rtf => &self.rtf_provider,
      DocumentType::Odt => &self.odt_provider,
    }
  }
}
