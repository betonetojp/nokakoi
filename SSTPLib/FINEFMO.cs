using System;
using System.Collections.Generic;

namespace SSTPLib {
    /// <summary>
    /// FINE FMO�̂P�f�[�^�i�P�A�v���P�[�V�����j��\���N���X�ł�
    /// </summary>
    public class FineFMOData {
        string m_ApplicationName;
        Dictionary<string, List<string>> m_property = new Dictionary<string, List<string>>();

        /// <summary>
        /// �R���X�g���N�^
        /// </summary>
        /// <param key="appname">�A�v���P�[�V������</param>
        public FineFMOData(string appname) {
            m_ApplicationName = appname;
        }

        /// <summary>
        /// �A�v���P�[�V���������擾���܂�
        /// </summary>
        public string AppicationName {
            get { return m_ApplicationName; }
        }

        /// <summary>
        /// �v���p�e�B���擾���܂�
        /// </summary>
        /// <param key="key">�L�[</param>
        /// <returns>�v���p�e�B</returns>
        public string[] GetProperty(string key) {
            if (m_property.ContainsKey(key)) {
                List<string> ar = m_property[key];
                string[] vals = new string[ar.Count];
                ar.CopyTo(vals, 0);
                return vals;
            } else {
                return null;
            }
        }

        /// <summary>
        /// �v���p�e�B��ݒ肵�܂�
        /// </summary>
        /// <param key="key">�L�[</param>
        /// <param key="val">�v���p�e�B�l</param>
        public void SetProperty(string key, string val) {
            if (m_property.ContainsKey(key)) {
                //
            } else {
                m_property[key] = new List<string>();
            }
            List<string> ar = m_property[key];
            ar.Add(val);
        }

        /// <summary>
        /// ���݂���v���p�e�B����񋓂��܂�
        /// </summary>
        /// <returns>�v���p�e�B��</returns>
        public string[] GetPropertyNames() {
            if (m_property.Keys.Count == 0) {
                return null;
            }
            string[] keys = new string[m_property.Keys.Count];
            m_property.Keys.CopyTo(keys, 0);
            return keys;
        }
    }


    /// <summary>
    /// FINE FMO �̓��e��\���N���X�ł��B
    /// </summary>
    public class FineFMO : IFMOReader {
        private FMO m_FMO;
        private Dictionary<string, FineFMOData> m_FineData;

        /// <summary>
        /// �R���X�g���N�^�FFMO�� "Fine"
        /// </summary>
        public FineFMO() : this("Fine") { }

        /// <summary>
        /// �R���X�g���N�^
        /// </summary>
        /// <param name="fmoname">FMO����</param>
        public FineFMO(string fmoname) {
            m_FMO = new FMO(fmoname);
        }

        /// <summary>
        /// FMO�̓��e��ǂݍ��݂܂�
        /// </summary>
        /// <param name="isUseMutex">�ǂݍ��݂�Mutex���g���ꍇTRUE</param>
        /// <returns>�ǂݍ��ݐ����^���s</returns>
        public bool Update(bool isUseMutex) {
            if (m_FMO.UpdateData(isUseMutex) == true) {
                return ParseFMO(m_FMO.FMOString);
            } else {
                return false;
            }
        }

        /// <summary>
        /// �A�v���P�[�V�����̃f�[�^���擾���܂�
        /// </summary>
        /// <param name="appname">�A�v���P�[�V������</param>
        /// <returns>�A�v���P�[�V�����̃f�[�^��\��FineFMOData�B���݂��Ȃ��ꍇ��null���Ԃ���܂�</returns>
        public FineFMOData GetApplicationData(string appname) {
            if (m_FineData == null) {
                return null;
            }
            if (m_FineData.ContainsKey(appname)) {
                return (FineFMOData)m_FineData[appname];
            } else {
                return null;
            }
        }

        /// <summary>
        /// �A�v���P�[�V������񋓂��܂�
        /// </summary>
        /// <returns>�A�v���P�[�V�������̔z��</returns>
        public String[] GetApplicationNames() {
            if (m_FineData == null) {
                return null;
            }
            if (m_FineData.Keys.Count == 0) {
                return null;
            }
            string[] keys = new string[m_FineData.Keys.Count];
            m_FineData.Keys.CopyTo(keys, 0);
            return keys;
        }

        /// <summary>
        /// FMO���
        /// </summary>
        /// <param name="fmodata">�f�[�^</param>
        /// <returns>�����^���s</returns>
        private bool ParseFMO(string fmodata) {
            m_FineData = new Dictionary<string, FineFMOData>();
            if (fmodata == null) {
                return false;
            }
            string[] lines = fmodata.Split(new char[] { '\n' });
            for (int i = 0; i < lines.Length; i++) {
                string[] tokens = lines[i].Split(new char[] { ':' });
                if (tokens.Length != 3) {
                    System.Diagnostics.Debug.WriteLine("illegal line:" + lines[i]);
                    continue;
                }
                string appname = tokens[0];
                string propname = tokens[1];
                string val = tokens[2];
                if (!m_FineData.ContainsKey(appname)) {
                    m_FineData[appname] = new FineFMOData(appname);
                }
                FineFMOData fd = (FineFMOData)m_FineData[appname];
                fd.SetProperty(propname, val);
            }
            return true;
        }
    }
}
