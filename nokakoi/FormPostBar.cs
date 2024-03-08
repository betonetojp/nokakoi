namespace nokakoi
{
    public partial class FormPostBar : Form
    {
        internal FormMain? FormMain;
        private Point mousePoint;

        public FormPostBar()
        {
            InitializeComponent();
        }

        private void buttonPost_Click(object sender, EventArgs e)
        {
            if (null != FormMain)
            {
                FormMain.textBoxPost.Text = textBoxPost.Text;
                FormMain.buttonPost_Click(sender, e);
            }
        }

        private void FormPostBar_MouseDown(object sender, MouseEventArgs e)
        {
            if ((e.Button & MouseButtons.Left) == MouseButtons.Left)
            {
                mousePoint = new Point(e.X, e.Y);
            }
        }

        private void FormPostBar_MouseMove(object sender, MouseEventArgs e)
        {
            if ((e.Button & MouseButtons.Left) == MouseButtons.Left)
            {
                Left += e.X - mousePoint.X;
                Top += e.Y - mousePoint.Y;
            }
        }

        private void FormPostBar_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                if (null != FormMain)
                {
                    FormMain.checkBoxPostBar.Checked = false;
                }
                Visible = false;
                e.Cancel = true;
            }
        }

        private void FormPostBar_Shown(object sender, EventArgs e)
        {
            Close();
        }

        private void FormPostBar_DoubleClick(object sender, EventArgs e)
        {
            if (null != FormMain)
            {
                if (FormWindowState.Minimized == FormMain.WindowState)
                {
                    FormMain.WindowState = FormWindowState.Normal;
                }
                else
                {
                    FormMain.WindowState = FormWindowState.Minimized;
                }
            }
        }
    }
}
