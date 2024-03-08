using System;
using System.Drawing;
using System.Collections.Generic;
using System.ComponentModel;
using System.Windows.Forms;
using System.Runtime.InteropServices;

namespace SSTPLib {
    /// <summary>
    /// SSTPの結果を受け取るための不可視ウィンドウです
    /// </summary>
    public class FrmMsgReceiver : System.Windows.Forms.NativeWindow {
        /// <summary>
        /// WM_COPYDATAを受け取るとセットされます
        /// </summary>
        public System.Threading.AutoResetEvent m_arevent;

        /// <summary>
        /// WM_COPYDATAを受け取った場合中身が入ります
        /// </summary>
        public byte[] m_recvdata;


        private const int WM_COPYDATA = 0x4A;
        private const int WM_DESTROY = 0x02;
        private const int WS_CHILD = 0x40000000;
        private const int WS_VISIBLE = 0x10000000;
        [StructLayout(LayoutKind.Sequential)]
        private struct COPYDATASTRUCT {
            public IntPtr dwData;
            public int cbData;
            public IntPtr lpData;
        }

        public FrmMsgReceiver() {
            CreateParams cp = new CreateParams();

            // Fill in the CreateParams details.
            cp.Caption = "frmMsgReceiver";
            //cp.ClassName = "frmMsgReceiver";

            // Set the position on the form
            cp.X = 100;
            cp.Y = 100;
            cp.Height = 100;
            cp.Width = 100;

            // Specify the form as the parent.
            //cp.Parent = IntPtr.Zero;

            // Create as a child of the specified parent
#if DEBUG
            cp.Style = WS_VISIBLE;
#endif
            // Create the actual window
            this.CreateHandle(cp);
        }


        protected override void WndProc(ref Message m) {
            System.Diagnostics.Debug.WriteLine("mes=" + m.Msg.ToString());
            if (m.Msg == WM_COPYDATA) {
                COPYDATASTRUCT cds;
                cds = (COPYDATASTRUCT)Marshal.PtrToStructure(m.LParam, typeof(COPYDATASTRUCT));
                m_recvdata = new byte[cds.cbData];
                for (int i = 0; i < cds.cbData; i++) {
                    m_recvdata[i] = Marshal.ReadByte(cds.lpData, i);
                }
                m.Result = (IntPtr)1;
                m_arevent.Set();
                return;
            }//else if(m.Msg==WM_DESTROY){
            //	Application.ExitThread();
            //}
            base.WndProc(ref m);
        }
    }
}
