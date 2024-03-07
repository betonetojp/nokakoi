
C# SSTPライブラリ

【これは何か】
C#でSSTPを送信するためのライブラリです。

【つかいかた】
SSTP(SEND/1.4)を送るだけなら

	DSSTPSender ds=new DSSTPSender();
	ds.Send14("Sender","SakuraName","Script",null,false);

でOKです。

【ライセンス】
	Creative Commons - CC0 1.0 Universal
	http://creativecommons.org/publicdomain/zero/1.0/

【履歴】
2007/10/13	Ver3.1.0	公開開始 by ukiya
2022/03/02	Ver3.2.0	SSTPプロトコル違反の修正、Shift_JIS以外の文字コード対応 by Don
2022/03/08	Ver4.0.0	ゴースト名取得時にSakuraUnicode FMOを使用 by Don

【連絡先】
----------------------------------
すくりや
----------------------------------
 https://nikolat.github.io/
----------------------------------
