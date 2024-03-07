using System;
using System.Collections.Generic;

namespace SSTPLib {

    /// <summary>
    /// "Sakura" FMOの１データ（１ゴースト）を表すクラスです
    /// </summary>
    public class SakuraFMOData {
        public string id;
        public uint hwnd;
        public uint kerohwnd;
        public string name;
        public string keroname;
        public int sakura_surface;
        public int kero_surface;
    }

    /// <summary>
    /// "Sakura" FMOを表すクラスです
    /// </summary>
    public class SakuraFMO : IFMOReader {
        private Dictionary<string, SakuraFMOData> m_FMOData_id;
        private Dictionary<string, SakuraFMOData> m_FMOData_name;
        private FMO m_FMO;

        #region コンストラクタ
        /// <summary>
        /// コンストラクタ：FMO名称"Sakura"
        /// </summary>
        public SakuraFMO() : this("Sakura") { }

        /// <summary>
        /// コンストラクタ
        /// </summary>
        /// <param name="fmoname">FMO名称</param>
        public SakuraFMO(string fmoname) {
            m_FMO = new FMO(fmoname);
            m_FMOData_id = new Dictionary<string, SakuraFMOData>();
            m_FMOData_name = new Dictionary<string, SakuraFMOData>();
        }
        #endregion

        #region パブリックメンバ
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
        /// ゴーストのHWNDを取得します
        /// </summary>
        /// <param name="sakuraname">取得するゴーストのsakuraname</param>
        /// <returns>HWNDの値、失敗した場合は0</returns>
        public uint GetGhostHWnd(string sakuraname) {
            if (sakuraname == null || sakuraname.Length == 0) {
                foreach (SakuraFMOData fd in m_FMOData_id.Values) {
                    if (fd.hwnd != 0) {
                        return fd.hwnd;
                    }
                }
                return 0;
            } else {
                if (m_FMOData_name.ContainsKey(sakuraname)) {
                    SakuraFMOData fd = m_FMOData_name[sakuraname];
                    return fd.hwnd;
                } else {
                    return 0;
                }
            }
        }

        /// <summary>
        /// ゴーストを表す SakuraFMODataクラスを取得します
        /// </summary>
        /// <param name="sakuraname">取得するゴーストのsakuraname</param>
        /// <returns>取得したゴーストのSakuraFMOData、失敗した場合はnull</returns>
        public SakuraFMOData GetGhostFMOData(string sakuraname) {
            if (m_FMOData_name.ContainsKey(sakuraname)) {
                SakuraFMOData fd = m_FMOData_name[sakuraname];
                return fd;
            } else {
                return null;
            }
        }

        /// <summary>
        /// FMOに存在するゴースト名を列挙します
        /// </summary>
        /// <returns>ゴースト名の配列</returns>
        public string[] GetGhostNames() {
            //if(m_FMOData_name!=null){
            int count = m_FMOData_name.Keys.Count;
            //	if(count!=0){
            string[] names = new string[count];
            m_FMOData_name.Keys.CopyTo(names, 0);
            return names;
            //	}
            //}
            //return null;
        }
        #endregion


        #region プライベート関数
        private bool ParseFMO(string fmodata) {
            if (m_FMOData_id != null) {
                m_FMOData_id = new Dictionary<string, SakuraFMOData>();
            }
            if (m_FMOData_name != null) {
                m_FMOData_name = new Dictionary<string, SakuraFMOData>();
            }
            if (fmodata == null) {
                return false;
            }
            string[] pair = fmodata.Split(new char[] { '\n' });
            for (int i = 0; i < pair.Length; i++) {
                System.Diagnostics.Debug.WriteLine(pair[i]);
                string[] token = pair[i].Split(new char[] { '\u0001' });
                if (token.Length != 2) {
                    System.Diagnostics.Debug.WriteLine("illegal pair:" + pair[i]);
                    continue;
                }
                string entry = token[0];
                string val = token[1];
                string[] token2 = entry.Split(new char[] { '.' });
                if (token2.Length < 2) {
                    System.Diagnostics.Debug.WriteLine("illegal entry:" + entry);
                    continue;
                }
                string id = token2[0];
                string key = token2[1];

                if (m_FMOData_name == null || m_FMOData_id == null) {
                    return false;
                }
                if (!m_FMOData_id.ContainsKey(id)) {
                    m_FMOData_id[id] = new SakuraFMOData();
                    m_FMOData_id[id].id = id;
                }
                SakuraFMOData fd = m_FMOData_id[id];
                switch (key.ToLower()) {
                    case "hwnd":
                        uint v1;
                        bool result1 = uint.TryParse(val, out v1);
                        if (result1) {
                            fd.hwnd = v1;
                        } else {
                            System.Diagnostics.Debug.WriteLine("illegal hwnd value:" + val);
                        }
                        break;
                    case "name":
                        fd.name = val;
                        if (m_FMOData_name.ContainsKey(val)) {
                            System.Diagnostics.Debug.WriteLine("overwrite:" + val);
                        } else {
                            m_FMOData_name[val] = fd;
                        }
                        break;
                    case "keroname":
                        fd.keroname = val;
                        break;
                    case "sakura":
                        int v2;
                        bool result2 = int.TryParse(val, out v2);
                        if (result2) {
                            fd.sakura_surface = v2;
                        } else {
                            System.Diagnostics.Debug.WriteLine("illegal sakura.surface value:" + val);
                        }
                        break;
                    case "kero":
                        int v3;
                        bool result3 = int.TryParse(val, out v3);
                        if (result3) {
                            fd.kero_surface = v3;
                        } else {
                            System.Diagnostics.Debug.WriteLine("illegal kero.surface value:" + val);
                        }
                        break;
                    case "kerohwnd":
                        uint v4;
                        bool result4 = uint.TryParse(val, out v4);
                        if (result4) {
                            fd.kerohwnd = v4;
                        } else {
                            System.Diagnostics.Debug.WriteLine("illegal kerohwnd value:" + val);
                        }
                        break;
                }//end of switch
            }//end of for
            return true;
        }//end of function
        #endregion

    }
}
