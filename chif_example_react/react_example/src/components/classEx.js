import React from 'react';

import chifv2 from '../chif_files/v2_Example.chif';
import chifv3 from '../chif_files/v3_Example.chif';

export default class ClassEx extends React.Component {
	componentDidMount() {
		window.chifPlayer.streamFiles();
	}
	render() {
		return (
			<div class="page">
				<div className="sep">
					<h2>CHIF Version 2 Example</h2>
					<chear src={chifv2}></chear>
				</div>
				<div className="sep">
					<h2>CHIF Version 3 Example</h2>
					<chear src={chifv3}></chear>
				</div>
			</div>
		);
	}
}
