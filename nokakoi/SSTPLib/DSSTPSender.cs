using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace SSTPLib {
    /// <summary>
    /// DSSTP送信クラス
    /// </summary>
    public class DSSTPSender : IDisposable {
        #region Win32関数
        [StructLayout(LayoutKind.Sequential)]
        public struct COPYDATASTRUCT {
            public IntPtr dwData;
            public int cbData;
            public IntPtr lpData;
        }
        [DllImport("user32", CharSet = CharSet.Auto)]
        public extern static bool SendMessageTimeout(
            IntPtr hWnd,
            uint Msg,
            IntPtr wParam,
            ref COPYDATASTRUCT lParam,
            uint fuFlags,
            uint uTimeout,
            ref int lpdwResult
        );
        private const int SMTO_NORMAL = 0x0000;
        private const int SMTO_BLOCK = 0x0001;
        private const int SMTO_ABORTIFHUNG = 0x0002;
        private const int SMTO_NOTIMEOUTIFNOTHUNG = 0x0008;
        private const int WM_COPYDATA = 0x4A;
        private const int WM_DESTROY = 0x2;
        #endregion

        private SakuraFMO m_fmo = null;
        private FrmMsgReceiver m_frmMsgReceiver = null;
        private AutoResetEvent m_arevent = null;
        private Thread m_recvThread = null;
        private string m_result = null;
        private int m_sendmsgto = 3000;
        private int m_recvmsgto = 3000;

        #region コンストラクタ、デストラクタ、プロパティ
        /// <summary>
        /// コンストラクタ："Sakura" FMO
        /// </summary>
        public DSSTPSender()
            : this("Sakura") {
        }

        /// <summary>
        /// コンストラクタ
        /// </summary>
        /// <param key="fmoName">FMO名称</param>
        public DSSTPSender(string fmoName) {
            m_fmo = new SakuraFMO(fmoName);
            m_fmo.Update(false);
            m_arevent = new AutoResetEvent(false);

            //create recv window thread
            //m_frmMsgReceiver=new FrmMsgReceiver();
            m_recvThread = new Thread(new ThreadStart(this.ThreadProc));
            m_recvThread.Priority = ThreadPriority.Lowest;
            m_recvThread.Start();
            m_arevent.WaitOne();
        }
        /// <summary>
        /// デストラクタ
        /// </summary>
        ~DSSTPSender() {
            this.Dispose();
        }
        /// <summary>
        /// SSTPの戻り値を取得します
        /// </summary>
        public string Result {
            get { return m_result; }
        }
        /// <summary>
        /// SSTP送信完了までのタイムアウト時間（ミリ秒）を設定・取得します
        /// </summary>
        public int SendMessageTimeOut {
            get { return m_sendmsgto; }
            set { m_sendmsgto = value; }
        }
        /// <summary>
        /// SSTP送信後、結果受信までのタイムアウト時間（ミリ秒）を設定・取得します
        /// </summary>
        public int RecvMessageTimeOut {
            get { return m_recvmsgto; }
            set { m_recvmsgto = value; }
        }
        /// <summary>
        /// SSTP結果受信用の不可視ウィンドウのハンドルを取得します
        /// </summary>
        public IntPtr HWnd {
            get { return m_frmMsgReceiver.Handle; }
        }
        /// <summary>
        /// FMO読み込み用のIFMOReaderを取得します
        /// </summary>
        public IFMOReader FMO {
            get { return m_fmo; }
        }
        #endregion

        #region メンバ関数
        /// <summary>
        /// FMOの内容を再読み込みします
        /// </summary>
        /// <returns>読み込み成功／失敗</returns>
        public bool Update() {
            return m_fmo.Update(false);
        }
        /// <summary>
        /// SEND/1.4を送信します
        /// </summary>
        /// <param key="sender">SSTP Sender パラメータ</param>
        /// <param key="ifghost">SSTP IfGhost パラメータ</param>
        /// <param key="script">SSTP Script パラメータ</param>
        /// <param key="keroname">FMOに指定のIfGhostが存在しない場合の keroname を指定します。
        /// FMOに存在した場合はFMOの内容で上書きされるため、通常はNULLで構いません。</param>
        /// <param key="isGetResult">SSTPの結果を待つ場合はTRUE 結果を待たず制御を返す場合はFALSE</param>
        /// <returns>SSTP送信の結果を返します</returns>
        public SSTPResult Send14(string sender, string ifghost, string script, string keroname, bool isGetResult) {
            uint hwnd;
            SakuraFMOData fd = m_fmo.GetGhostFMOData(ifghost);
            if (fd == null) {
                hwnd = m_fmo.GetGhostHWnd("");
            } else {
                hwnd = fd.hwnd;
                keroname = fd.keroname;
            }

            if (hwnd == 0) {
                return SSTPResult.ServerNotFound;
            }

            SSTPMessage msg = new SSTPMessage();
            msg.Method = SSTPMethod.SEND14;
            msg.Sender = sender;
            msg.Scripts = new SSTPIfGhostScript[] { new SSTPIfGhostScript(ifghost + "," + keroname, script) };
            msg.HWnd = (int)m_frmMsgReceiver.Handle;
            msg.XBottleIfGhost = ifghost;
            msg.CharSet = SSTPCharset.SHIFT_JIS;
            Byte[] data = msg.GetRequest();
            System.Diagnostics.Debug.WriteLine(msg.GetString());
            if (isGetResult) {
                return SendAndGetResult((IntPtr)hwnd, data);
            } else {
                bool res = DSSTPSender.SendWMCopyData((IntPtr)hwnd, m_frmMsgReceiver.Handle, data, this.SendMessageTimeOut);
                if (!res) {
                    return SSTPResult.SendMessageFailed;
                } else {
                    return SSTPResult.OK;
                }
            }
        }

        /// <summary>
        /// NOTIFY/1.1を送信します
        /// </summary>
        /// <param key="sender">SSTP Sender パラメータ</param>
        /// <param key="ghost">送信先のFMO上のsakura名称</param>
        /// <param key="notifyevent">SSTP Event パラメータ</param>
        /// <param key="references">SSTP Reference パラメータ</param>
        /// <param key="isGetResult">SSTPの結果を待つ場合はTRUE 結果を待たず制御を返す場合はFALSE</param>
        /// <returns>SSTP送信の結果を返します</returns>
        public SSTPResult Notify11(string sender, string ghost, string notifyevent, string[] references, bool isGetResult) {
            uint hwnd;
            hwnd = m_fmo.GetGhostHWnd(ghost);
            if (hwnd == 0) {
                hwnd = m_fmo.GetGhostHWnd(null);
            }
            if (hwnd == 0) {
                return SSTPResult.ServerNotFound;
            }
            SSTPMessage msg = new SSTPMessage();
            msg.Method = SSTPMethod.NOTIFY11;
            msg.Sender = sender;
            msg.Event = notifyevent;
            msg.References = references;
            msg.CharSet = SSTPCharset.SHIFT_JIS;
            msg.HWnd = (int)m_frmMsgReceiver.Handle;
            Byte[] data = msg.GetRequest();
            System.Diagnostics.Debug.WriteLine(msg.GetString());
            if (isGetResult) {
                return SendAndGetResult((IntPtr)hwnd, data);
            } else {
                bool res = DSSTPSender.SendWMCopyData((IntPtr)hwnd, m_frmMsgReceiver.Handle, data, this.SendMessageTimeOut);
                if (!res) {
                    return SSTPResult.SendMessageFailed;
                } else {
                    return SSTPResult.OK;
                }
            }
        }

        /// <summary>
        /// SSTPの内容を全て指定して送信します
        /// </summary>
        /// <param key="ghost">送信先のFMO上のsakura名称</param>
        /// <param key="sstpmsg">SSTPの内容</param>
        /// <param key="isGetResult">SSTPの結果を待つ場合はTRUE 結果を待たず制御を返す場合はFALSE</param>
        /// <returns>SSTP送信の結果を返します</returns>
        public SSTPResult SendSSTPString(string ghost, string sstpmsg, bool isGetResult) {
            uint hwnd;
            hwnd = m_fmo.GetGhostHWnd(ghost);
            if (hwnd == 0) {
                hwnd = m_fmo.GetGhostHWnd(null);
            }
            if (hwnd == 0) {
                return SSTPResult.ServerNotFound;
            }
            sstpmsg += "Charset: Shift_JIS\r\n";
            Byte[] data = System.Text.Encoding.GetEncoding("Shift-JIS").GetBytes(sstpmsg);
            if (isGetResult) {
                return SendAndGetResult((IntPtr)hwnd, data);
            } else {
                bool res = DSSTPSender.SendWMCopyData((IntPtr)hwnd, m_frmMsgReceiver.Handle, data, this.SendMessageTimeOut);
                if (!res) {
                    return SSTPResult.SendMessageFailed;
                } else {
                    return SSTPResult.OK;
                }
            }
        }

        /// <summary>
        /// SSTPの内容を全て指定して送信します
        /// </summary>
        /// <param key="ghost">送信先のFMO上のsakura名称</param>
        /// <param key="sstpmsg">SSTPの内容</param>
        /// <param key="isGetResult">SSTPの結果を待つ場合はTRUE 結果を待たず制御を返す場合はFALSE</param>
        /// <returns>SSTP送信の結果を返します</returns>
        public string GetSSTPResponse(string ghost, string sstpmsg)
        {
            uint hwnd;
            hwnd = m_fmo.GetGhostHWnd(ghost);
            if (hwnd == 0) {
                hwnd = m_fmo.GetGhostHWnd(null);
            }
            if (hwnd == 0) {
                return null;
            }
            List<string> msg = new List<string>(sstpmsg.Split("\r\n"));
            string charset = "";
            foreach (string s in msg) {
                if (s.StartsWith("Charset: ")) {
                    charset = s[9..];
                    break;
                }
            }
            System.Text.Encoding enc;
            try {
                enc = System.Text.Encoding.GetEncoding(charset);
            }
            catch (ArgumentException) {
                charset = "UTF-8";
                enc = System.Text.Encoding.GetEncoding(charset);
            }
            Byte[] data = enc.GetBytes(sstpmsg);

            return SendAndGetResultString((IntPtr)hwnd, data, charset);
        }

        /// <summary>
        /// SSTPの内容をバイナリで指定して送信し、結果を待ちます
        /// </summary>
        /// <param key="desthwnd">送信先のHWND</param>
        /// <param key="data">送信するデータ</param>
        /// <returns>SSTP送信の結果を返します</returns>
        public SSTPResult SendAndGetResult(IntPtr desthwnd, Byte[] data) {
            bool result = DSSTPSender.SendWMCopyData(desthwnd, m_frmMsgReceiver.Handle, data, this.SendMessageTimeOut);
            if (!result) {
                return SSTPResult.SendMessageFailed;
            }
            bool waitresult = m_arevent.WaitOne(this.RecvMessageTimeOut, false);
            if (!waitresult) {
                return SSTPResult.ResultTimeOut;
            }
            m_result = System.Text.Encoding.GetEncoding("Shift-JIS").GetString(m_frmMsgReceiver.m_recvdata);
            System.Diagnostics.Debug.WriteLine(this.Result);
            string[] token = m_result.Split(new char[] { ' ' });
            if (token.Length < 3) {
                return SSTPResult.IllegalResultData;
            }
            int resultcode = 0;
            int val;
            bool result2 = int.TryParse(token[1], out val);
            if (result2) {
                resultcode = val;
            } else {
                return SSTPResult.IllegalResultData;
            }
            if (!Enum.IsDefined(typeof(SSTPResult), resultcode)) {
                return SSTPResult.UndefinedResultCode;
            }
            SSTPResult res = (SSTPResult)Enum.ToObject(typeof(SSTPResult), resultcode);
            return res;
        }

        /// <summary>
        /// SSTPの内容をバイナリで指定して送信し、結果を待ちます
        /// </summary>
        /// <param key="desthwnd">送信先のHWND</param>
        /// <param key="data">送信するデータ</param>
        /// <returns>SSTP送信の結果を返します</returns>
        public string SendAndGetResultString(IntPtr desthwnd, Byte[] data, string charset)
        {
            bool result = DSSTPSender.SendWMCopyData(desthwnd, m_frmMsgReceiver.Handle, data, this.SendMessageTimeOut);
            if (!result)
            {
                return null;
            }
            bool waitresult = m_arevent.WaitOne(this.RecvMessageTimeOut, false);
            if (!waitresult)
            {
                return null;
            }
            m_result = System.Text.Encoding.GetEncoding(charset).GetString(m_frmMsgReceiver.m_recvdata);
            return this.Result;
        }

        /// <summary>
        /// WM_COPYDATAを送信します。送信完了まで処理はブロックされます。
        /// </summary>
        /// <param key="desthwnd">送信先HWND</param>
        /// <param key="srchwnd">送信元HWND</param>
        /// <param key="data">送信データ</param>
        /// <param key="timeout">送信完了待ちタイムアウト時間</param>
        /// <returns>送信成功／失敗</returns>
        public static bool SendWMCopyData(IntPtr desthwnd, IntPtr srchwnd, Byte[] data, int timeout) {
            IntPtr ptrData = Marshal.AllocCoTaskMem(data.Length);
            Marshal.Copy(data, 0, ptrData, data.Length);

            COPYDATASTRUCT cds = new COPYDATASTRUCT();
            cds.cbData = data.Length;
            cds.dwData = IntPtr.Zero;
            cds.lpData = ptrData;
            int resvalue = 0;

            bool result = SendMessageTimeout(desthwnd, WM_COPYDATA, srchwnd, ref cds,
                SMTO_ABORTIFHUNG | SMTO_BLOCK, (uint)timeout, ref resvalue);

            Marshal.FreeCoTaskMem(ptrData);

            return result;
        }

        /// <summary>
        /// WM_COPYDATAを送信します。送信完了まで処理をブロックしません。（未使用）
        /// </summary>
        /// <param key="desthwnd">送信先HWND</param>
        /// <param key="srchwnd">送信元HWND</param>
        /// <param key="data">送信データ</param>
        /// <param key="timeout">送信完了待ちタイムアウト時間</param>
        /// <returns>送信成功／失敗</returns>
        public static bool SendWMCopyDataNoBlock(IntPtr desthwnd, IntPtr srchwnd, Byte[] data, int timeout) {
            IntPtr ptrData = Marshal.AllocCoTaskMem(data.Length);
            Marshal.Copy(data, 0, ptrData, data.Length);

            COPYDATASTRUCT cds = new COPYDATASTRUCT();
            cds.cbData = data.Length;
            cds.dwData = IntPtr.Zero;
            cds.lpData = ptrData;
            int resvalue = 0;

            bool result = SendMessageTimeout(desthwnd, WM_COPYDATA, srchwnd, ref cds,
                SMTO_ABORTIFHUNG, (uint)timeout, ref resvalue);

            Marshal.FreeCoTaskMem(ptrData);

            return result;
        }
        #endregion

        private void ThreadProc() {
            //System.Diagnostics.Debug.WriteLine("threadproc start");
            m_frmMsgReceiver = new FrmMsgReceiver();
            m_frmMsgReceiver.m_arevent = this.m_arevent;
            m_arevent.Set();
            System.Windows.Forms.Application.Run();
            //while(true){
            //	System.Windows.Forms.Application.DoEvents();
            //}
            //m_frmMsgReceiver.ShowDialog();
            //System.Diagnostics.Debug.WriteLine("threadproc end");
        }

        #region IDisposable メンバ

        public void Dispose() {
            // TODO:  DSSTPSender.Dispose 実装を追加します。
            System.Diagnostics.Debug.WriteLine("Dispose");
            if (m_frmMsgReceiver.Handle != IntPtr.Zero) {
                m_frmMsgReceiver.DestroyHandle();
            }
            if (m_recvThread != null) {
                m_recvThread.Join(1000);
                //				m_recvThread.Abort();
                m_recvThread = null;
            }
        }

        #endregion
    }
}
