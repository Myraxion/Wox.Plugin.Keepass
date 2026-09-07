import { WoxImage } from "@wox-launcher/wox-plugin"
import * as kdbxweb from "kdbxweb"

export const STANDARD_ICONS: Record<number, string> = {
  0: "C00_Password.svg",
  1: "C01_Package_Network.svg",
  2: "C02_MessageBox_Warning.svg",
  3: "C03_Server.svg",
  4: "C04_Klipper.svg",
  5: "C05_Edu_Languages.svg",
  6: "C06_KCMDF.svg",
  7: "C07_Kate.svg",
  8: "C08_Socket.svg",
  9: "C09_Identity.svg",
  10: "C10_Kontact.svg",
  11: "C11_Camera.svg",
  12: "C12_IRKickFlash.svg",
  13: "C13_KGPG_Key3.svg",
  14: "C14_Laptop_Power.svg",
  15: "C15_Scanner.svg",
  16: "C16_Mozilla_Firebird.svg",
  17: "C17_CDROM_Unmount.svg",
  18: "C18_Display.svg",
  19: "C19_Mail_Generic.svg",
  20: "C20_Misc.svg",
  21: "C21_KOrganizer.svg",
  22: "C22_ASCII.svg",
  23: "C23_Icons.svg",
  24: "C24_Connect_Established.svg",
  25: "C25_Folder_Mail.svg",
  26: "C26_FileSave.svg",
  27: "C27_NFS_Unmount.svg",
  28: "C28_QuickTime.svg",
  29: "C29_KGPG_Term.svg",
  30: "C30_Konsole.svg",
  31: "C31_FilePrint.svg",
  32: "C32_FSView.svg",
  33: "C33_Run.svg",
  34: "C34_Configure.svg",
  35: "C35_KRFB.svg",
  36: "C36_Ark.svg",
  37: "C37_KPercentage.svg",
  38: "C38_Samba_Unmount.svg",
  39: "C39_History.svg",
  40: "C40_Mail_Find.svg",
  41: "C41_VectorGfx.svg",
  42: "C42_KCMMemory.svg",
  43: "C43_EditTrash.svg",
  44: "C44_KNotes.svg",
  45: "C45_Cancel.svg",
  46: "C46_Help.svg",
  47: "C47_KPackage.svg",
  48: "C48_Folder.svg",
  49: "C49_Folder_Blue_Open.svg",
  50: "C50_Folder_Tar.svg",
  51: "C51_Decrypted.svg",
  52: "C52_Encrypted.svg",
  53: "C53_Apply.svg",
  54: "C54_Signature.svg",
  55: "C55_Thumbnail.svg",
  56: "C56_KAddressBook.svg",
  57: "C57_View_Text.svg",
  58: "C58_KGPG.svg",
  59: "C59_Package_Development.svg",
  60: "C60_KFM_Home.svg",
  61: "C61_Services.svg",
  62: "C62_Tux.svg",
  63: "C63_Feather.svg",
  64: "C64_Apple.svg",
  65: "C65_W.svg",
  66: "C66_Money.svg",
  67: "C67_Certificate.svg",
  68: "C68_BlackBerry.svg"
}

export function getStandardIconPath(iconIndex?: number): string {
  const filename = (iconIndex !== undefined && STANDARD_ICONS[iconIndex]) || STANDARD_ICONS[0]
  return `icons/database/${filename}`
}

export function getCustomIconDataUri(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let mimeType = "image/png"
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      mimeType = "image/png"
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      mimeType = "image/jpeg"
    } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      mimeType = "image/gif"
    } else if (bytes[0] === 0x3c) {
      mimeType = "image/svg+xml"
    }
  }
  const base64 = Buffer.from(data).toString("base64")
  return `data:${mimeType};base64,${base64}`
}

export function resolveEntryIcon(entry: kdbxweb.KdbxEntry, db: kdbxweb.Kdbx): WoxImage {
  if (entry.customIcon) {
    const customIcon = db.meta.customIcons.get(entry.customIcon.toString())
    if (customIcon && customIcon.data && customIcon.data.byteLength > 0) {
      return {
        ImageType: "base64",
        ImageData: getCustomIconDataUri(customIcon.data)
      }
    }
  }

  return {
    ImageType: "relative",
    ImageData: getStandardIconPath(entry.icon)
  }
}
