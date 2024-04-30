using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace nokakoi
{
    public partial class FormUsers : Form
    {
        internal FormMain? _formMain;
        public FormUsers()
        {
            InitializeComponent();
        }

        private void FormUsers_Load(object sender, EventArgs e)
        {
            if (_formMain != null)
            {
                foreach (var user in _formMain._users)
                {
                    dataGridViewUsers.Rows.Add(user.Value?.Mute, user.Value?.DisplayName, user.Value?.Name, user.Key);
                }
            }
        }

        private void ButtonSave_Click(object sender, EventArgs e)
        {
            if (_formMain != null)
            {
                foreach (DataGridViewRow row in dataGridViewUsers.Rows)
                {
                    if (row.Cells[3].Value != null)
                    {
                        var key = row.Cells[3].Value.ToString();
                        if (key != null && _formMain._users.TryGetValue(key, out User? user))
                        {
                            if (user != null)
                            {
                                user.Mute = (bool)row.Cells[0].Value;
                            }
                        }
                    }
                }
            }
            Close();
        }
    }
}
