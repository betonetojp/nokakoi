using System;
using System.Runtime.InteropServices;
using System.Text;

namespace SSTPLib {
    /// <summary>
    /// FMO�̓��e��\���N���X�̃C���^�t�F�[�X�ł�
    /// </summary>
    public interface IFMOReader {
        /// <summary>
        /// FMO�̓��e���擾���A��͂��܂�
        /// </summary>
        /// <param name="isUseMutex">�擾��Mutex���g���ꍇ��true</param>
        /// <returns>�����^���s</returns>
        bool Update(bool isUseMutex);
    }

    /// <summary>
    /// File Mapping Object ��\���N���X�ł�
    /// </summary>
    public class FMO {
        private string m_FMOName;
        private string m_fmostring;
        private System.Threading.Mutex m_mutex = null;
        private IntPtr m_hFMO = IntPtr.Zero;
        private IntPtr m_hNativeAddress = IntPtr.Zero;

        #region Win32�֐�
        [DllImport("kernel32.dll")]
        public static extern IntPtr OpenFileMapping(int dwDesiredAccess, bool bInheritHandle, string lpName);
        public const int SECTION_MAP_READ = 0x4;
        public const int SECTION_MAP_WRITE = 0x2;
        public const int FILE_MAP_READ = SECTION_MAP_READ;
        public const int FILE_MAP_WRITE = SECTION_MAP_WRITE;
        public const int STANDARD_RIGHTS_REQUIRED = 0xF0000;
        public const int SECTION_QUERY = 0x1;
        public const int SECTION_MAP_EXECUTE = 0x8;
        public const int SECTION_EXTEND_SIZE = 0x10;
        public const int SECTION_ALL_ACCESS = STANDARD_RIGHTS_REQUIRED | SECTION_QUERY |
            SECTION_MAP_WRITE | SECTION_MAP_READ | SECTION_MAP_EXECUTE | SECTION_EXTEND_SIZE;
        public const int FILE_MAP_ALL_ACCESS = SECTION_ALL_ACCESS;


        [StructLayout(LayoutKind.Sequential)]
        public struct SECURITY_ATTRIBUTES {
            public long nLength;
            public long lpSecurityDescriptor;
            public long bInheritHandle;
        }
        [DllImport("kernel32.dll")]
        public static extern IntPtr CreateFileMapping(
            uint hFile,                       // �t�@�C���̃n���h��
            uint lpAttributes, // �Z�L�����e�B
            int flProtect,                    // �ی�
            uint dwMaximumSizeHigh,            // �T�C�Y��\����� DWORD
            uint dwMaximumSizeLow,             // �T�C�Y��\������ DWORD
            string lpName                      // �I�u�W�F�N�g��
        );
        public const int PAGE_READWRITE = 0x04;
        public const int ERROR_ALREADY_EXISTS = 0x183;

        [DllImport("kernel32.dll")]
        public static extern IntPtr MapViewOfFile(IntPtr hFileMappingObject,
            int dwDesiredAccess, int dwFileOffsetHigh,
            int dwFileOffsetLow, int dwNumberOfBytesToMap);

        [DllImport("kernel32.dll")]
        public static extern bool UnmapViewOfFile(
            IntPtr lpBaseAddress
        );

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(
            IntPtr hObject
        );

        [DllImport("kernel32.dll")]
        public static extern uint GetLastError();
        #endregion


        #region �R���X�g���N�^�A�f�X�g���N�^�A�v���p�e�B

        /// <summary>
        /// �R���X�g���N�^�FFMO��"Sakura"
        /// </summary>
        public FMO() : this("Sakura") { }

        /// <summary>
        /// �R���X�g���N�^
        /// </summary>
        /// <param name="name">FMO����</param>
        public FMO(string name) {
            FMOName = name;
        }

        /// <summary>
        /// �f�X�g���N�^
        /// </summary>
        ~FMO() {
            UnLockFMO();
        }

        /// <summary>
        /// FMO���̂�ݒ�A�擾���܂�
        /// </summary>
        public string FMOName {
            get { return m_FMOName; }
            set { m_FMOName = value; }
        }

        /// <summary>
        /// FMO�̓��e�𕶎���Ŏ擾���܂�
        /// </summary>
        public string FMOString {
            get { return m_fmostring; }
        }
        #endregion

        #region �p�u���b�N�����o�[
        /// <summary>
        /// FMO��ǂݍ��݁AFMOString�̓��e���A�b�v�f�[�g���܂��B
        /// FMO�����b�N���A���e��ǂݍ��݁A�A�����b�N���܂��B
        /// Mutex�͎g���܂���B
        /// </summary>
        /// <returns></returns>
        public bool UpdateData() {
            return UpdateData(false);
        }

        /// <summary>
        /// FMO��ǂݍ��݁AFMOString�̓��e���A�b�v�f�[�g���܂��B
        /// FMO�����b�N���A���e��ǂݍ��݁A�A�����b�N���܂��B
        /// </summary>
        /// <param name="isUseMutex">���b�N�O��Mutex���擾����ꍇ��true</param>
        /// <returns>�����^���s</returns>
        public bool UpdateData(bool isUseMutex) {
            int size = 0;
            byte[] data;
            m_fmostring = null;
            try {
                if (LockFMO(isUseMutex, false) == false) {
                    return false;
                }
                size = Marshal.ReadInt32(m_hNativeAddress);
                if (size <= 4) {
                    return false;
                }
                data = new byte[size];
                for (int i = 0; i < data.Length - 4; i++) {
                    Byte dat = Marshal.ReadByte(m_hNativeAddress, i + 4);
                    if (dat == 0) {
                        break;
                    } else {
                        data[i] = dat;
                    }
                }
            } finally {
                UnLockFMO();
            }
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            System.Text.Encoding enc;
            if (this.FMOName == "SakuraUnicode")
                enc = System.Text.Encoding.UTF8;
            else
                enc = System.Text.Encoding.GetEncoding(
                    System.Threading.Thread.CurrentThread.CurrentCulture.TextInfo.ANSICodePage
                );
            m_fmostring = enc.GetString(data);
            m_fmostring = m_fmostring.Replace("\r\n", "\n");
            m_fmostring = m_fmostring.Trim(new char[] { '\u0000', '\u0001', '\n' });
            return true;
        }

        /// <summary>
        /// FMO�����b�N���܂��B
        /// </summary>
        /// <param name="isUseMutex">���b�N�O��Mutex���擾����ꍇ��true</param>
        /// <param name="isCreate">FMO���݂��Ȃ�������쐬����ꍇ��true</param>
        /// <returns>�����^���s</returns>
        public bool LockFMO(bool isUseMutex, bool isCreate) {
            m_mutex = null;
            m_hFMO = IntPtr.Zero;
            m_hNativeAddress = IntPtr.Zero;
            try {
                if (isUseMutex) {
                    m_mutex = new System.Threading.Mutex(false, this.FMOName + "FMO");
                    if (m_mutex == null) {
                        return false;
                    }
                    if (m_mutex.WaitOne(1000, false) == false) {
                        return false;
                    }
                }
                if (isCreate) {
                    m_hFMO = CreateFileMapping(0xFFFFFFFF, 0, PAGE_READWRITE, 0, 64 * 1024, this.FMOName);
                } else {
                    m_hFMO = OpenFileMapping(FILE_MAP_WRITE, false, this.FMOName);
                }
                if (m_hFMO == IntPtr.Zero) {
                    UnLockFMO();
                    return false;
                }
                m_hNativeAddress = MapViewOfFile(m_hFMO, FILE_MAP_WRITE, 0, 0, 0);
                if (m_hNativeAddress == IntPtr.Zero) {
                    System.Diagnostics.Debug.WriteLine(GetLastError().ToString());
                    UnLockFMO();
                    return false;
                }
            } catch (Exception ex) {
                System.Diagnostics.Debug.WriteLine(ex.Message);
                UnLockFMO();
                return false;
            }
            return true;
        }

        /// <summary>
        /// FMO���A�����b�N���܂��BMutex���擾���Ă���ꍇ�̓����[�X���܂��B
        /// </summary>
        /// <returns>�����^���s</returns>
        public bool UnLockFMO() {
            if (m_mutex != null) {
                m_mutex.ReleaseMutex();
                m_mutex.Close();
                m_mutex = null;
            }
            if (m_hNativeAddress != IntPtr.Zero) {
                UnmapViewOfFile(m_hNativeAddress);
                m_hNativeAddress = IntPtr.Zero;
            }
            if (m_hFMO != IntPtr.Zero) {
                CloseHandle(m_hFMO);
                m_hFMO = IntPtr.Zero;
            }
            return true;
        }

        #endregion
    }//end of class
}
