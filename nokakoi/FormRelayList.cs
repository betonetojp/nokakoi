namespace nokakoi
{
    public partial class FormRelayList : Form
    {
        public FormRelayList()
        {
            InitializeComponent();
        }

        private void FormRelayList_Load(object sender, EventArgs e)
        {
            dataGridViewRelayList.Rows.Clear();
            var relays = Tools.LoadRelays();
            foreach (var relay in relays)
            {
                dataGridViewRelayList.Rows.Add(relay.Enabled, relay.Url);
            }
            dataGridViewRelayList.ClearSelection();
        }

        private void ButtonSave_Click(object sender, EventArgs e)
        {
            List<Relay> relays = [];
            foreach (DataGridViewRow row in dataGridViewRelayList.Rows)
            {
                if (row.Cells[1].Value != null)
                {
                    var url = row.Cells[1].Value.ToString();
                    if (url != null && Uri.TryCreate(url, UriKind.Absolute, out Uri? uri))
                    {
                        if (uri != null)
                        {
                            var relay = new Relay
                            {
                                Enabled = row.Cells[0].Value != null && (bool)row.Cells[0].Value,
                                Url = uri.ToString()
                            };
                            relays.Add(relay);
                        }
                    }
                }
            }
            Tools.SaveRelays(relays);
            Close();
        }

        private void ButtonDelete_Click(object sender, EventArgs e)
        {
            // 選択された行を削除
            foreach (DataGridViewRow row in dataGridViewRelayList.SelectedRows)
            {
                dataGridViewRelayList.Rows.Remove(row);
            }
        }
    }
}
