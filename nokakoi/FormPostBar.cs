﻿namespace nokakoi
{
    public partial class FormPostBar : Form
    {
        internal FormMain? _formMain;
        private Point _mousePoint;

        public FormPostBar()
        {
            InitializeComponent();

            // ボタンの画像をDPIに合わせて表示
            float scale = CreateGraphics().DpiX / 96f;
            int size = (int)(16 * scale);
            if (scale < 2.0f)
            {
                buttonPost.Image = new Bitmap(Properties.Resources.icons8_create_16, size, size);
            }
            else
            {
                buttonPost.Image = new Bitmap(Properties.Resources.icons8_create_32, size, size);
            }
        }

        private void ButtonPost_Click(object sender, EventArgs e)
        {
            if (null != _formMain)
            {
                _formMain.textBoxPost.Text = textBoxPost.Text;
                _formMain.ButtonPost_Click(sender, e);
            }
        }

        private void FormPostBar_MouseDown(object sender, MouseEventArgs e)
        {
            if ((e.Button & MouseButtons.Left) == MouseButtons.Left)
            {
                _mousePoint = new Point(e.X, e.Y);
            }
        }

        private void FormPostBar_MouseMove(object sender, MouseEventArgs e)
        {
            if ((e.Button & MouseButtons.Left) == MouseButtons.Left)
            {
                Left += e.X - _mousePoint.X;
                Top += e.Y - _mousePoint.Y;
            }
        }

        private void FormPostBar_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                if (null != _formMain)
                {
                    _formMain.checkBoxPostBar.Checked = false;
                }
                Visible = false;
                e.Cancel = true;
            }
        }

        private void FormPostBar_Shown(object sender, EventArgs e)
        {
            // モーダル解除
            Close();
        }

        private void FormPostBar_DoubleClick(object sender, EventArgs e)
        {
            if (null != _formMain)
            {
                if (FormWindowState.Minimized == _formMain.WindowState)
                {
                    _formMain.WindowState = FormWindowState.Normal;
                }
                else
                {
                    _formMain.WindowState = FormWindowState.Minimized;
                }
            }
        }

        private void FormPostBar_MouseClick(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right)
            {
                FormPostBar_DoubleClick(sender, e);
            }
        }

        //private void TextBoxPost_KeyDown(object sender, KeyEventArgs e)
        //{
        //    if (e.KeyData == (Keys.Enter | Keys.Control))
        //    {
        //        ButtonPost_Click(sender, e);
        //    }
        //}

        private void FormPostBar_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.F11)
            {
                FormPostBar_DoubleClick(sender, e);
                // フォーカスキープ
                Activate();
            }
            if (e.KeyCode == Keys.F12)
            {
                Close();
            }
        }
    }
}
