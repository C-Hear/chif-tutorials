import React, { useEffect } from 'react';

import chif from '../chif_files/3d167eab-5fa7-432e-b16a-867560ea7b7f_chear.chif';

const FuncEx = props => {
  useEffect(() => {
    window.chifPlayer.streamFiles();
  }, []);
  return (
    <div class="page">
      <chear src={chif}></chear>
    </div>
  );
};

export default FuncEx;
