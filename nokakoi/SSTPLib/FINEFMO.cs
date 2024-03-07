using System;
using System.Collections.Generic;

namespace SSTPLib {
    /// <summary>
    /// FINE FMOの１データ（１アプリケーション）を表すクラスです
    /// </summary>
    public class FineFMOData {
        string m_ApplicationName;
        Dictionary<string, List<string>> m_property = new Dictionary<string, List<string>>();

        /// <summary>
        /// コンストラクタ
        /// </summary>
        /// <param key="appname">アプリケーション名</param>
        public FineFMOData(string appname) {
            m_ApplicationName = appname;
        }

        /// <summary>
        /// アプリケーション名を取得します
        /// </summary>
        public string AppicationName {
            get { return m_ApplicationName; }
        }

        /// <summary>
        /// プロパティを取得します
        /// </summary>
        /// <param key="key">キー</param>
        /// <returns>プロパティ</returns>
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
        /// プロパティを設定します
        /// </summary>
        /// <param key="key">キー</param>
        /// <param key="val">プロパティ値</param>
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
        /// 存在するプロパティ名を列挙します
        /// </summary>
        /// <returns>プロパティ名</returns>
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
    /// FINE FMO の内容を表すクラスです。
    /// </summary>
    public class FineFMO : IFMOReader {
        private FMO m_FMO;
        private Dictionary<string, FineFMOData> m_FineData;

        /// <summary>
        /// コンストラクタ：FMO名 "Fine"
        /// </summary>
        public FineFMO() : this("Fine") { }

        /// <summary>
        /// コンストラクタ
        /// </summary>
        /// <param name="fmoname">FMO名称</param>
        public FineFMO(string fmoname) {
            m_FMO = new FMO(fmoname);
        }

        /// <summary>
        /// FMOの内容を読み込みます
        /// </summary>
        /// <param name="isUseMutex">読み込みにMutexを使う場合TRUE</param>
        /// <returns>読み込み成功／失敗</returns>
        public bool Update(bool isUseMutex) {
            if (m_FMO.UpdateData(isUseMutex) == true) {
                return ParseFMO(m_FMO.FMOString);
            } else {
                return false;
            }
        }

        /// <summary>
        /// アプリケーションのデータを取得します
        /// </summary>
        /// <param name="appname">アプリケーション名</param>
        /// <returns>アプリケーションのデータを表すFineFMOData。存在しない場合はnullが返されます</returns>
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
        /// アプリケーションを列挙します
        /// </summary>
        /// <returns>アプリケーション名の配列</returns>
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
        /// FMO解析
        /// </summary>
        /// <param name="fmodata">データ</param>
        /// <returns>成功／失敗</returns>
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
